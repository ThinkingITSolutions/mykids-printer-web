/**
 * Busca de impressoras na rede local: mDNS/Bonjour + varredura da porta 9100 + SNMP (modelo/status) + MAC (ARP).
 * Requer rede "host" no Docker para o multicast funcionar.
 */
import os from 'node:os';
import fs from 'node:fs';
import mdnsFactory from 'multicast-dns';
import snmp from 'net-snmp';
import { probePort } from './transports.js';

export interface FoundPrinter {
  ip: string;
  mac?: string;
  name?: string; // nome mDNS (instância), ex.: "Brother QL-810W"
  model?: string;
  brand?: 'brother' | 'other';
  isBrotherQL: boolean;
  port9100: boolean;
  ipp: boolean;
  status?: string;
  via: string[];
}

const SERVICES = ['_pdl-datastream._tcp.local', '_printer._tcp.local', '_ipp._tcp.local'];

/** mDNS: pergunta pelos serviços de impressão e junta PTR/SRV/TXT/A. */
function mdnsBrowse(timeoutMs = 3000): Promise<Map<string, Partial<FoundPrinter>>> {
  return new Promise((resolve) => {
    const found = new Map<string, Partial<FoundPrinter>>();
    let mdns: ReturnType<typeof mdnsFactory>;
    try {
      mdns = mdnsFactory();
    } catch {
      return resolve(found);
    }
    const hostToIp = new Map<string, string>();
    const instHost = new Map<string, string>();
    const instTxt = new Map<string, Record<string, string>>();
    const instSvc = new Map<string, string>();
    const instFrom = new Map<string, string>(); // IP de quem respondeu (quando não vem registro A)
    mdns.on('response', (res: any, rinfo: { address: string }) => {
      for (const a of res.answers ?? []) if (a.type === 'PTR' && SERVICES.includes(a.name)) instFrom.set(a.data, rinfo.address);
      for (const a of [...(res.answers ?? []), ...(res.additionals ?? [])]) {
        if (a.type === 'PTR' && SERVICES.includes(a.name)) instSvc.set(a.data, a.name);
        if (a.type === 'SRV') instHost.set(a.name, a.data.target);
        if (a.type === 'A') hostToIp.set(a.name, a.data);
        if (a.type === 'TXT') {
          const kv: Record<string, string> = {};
          for (const b of a.data as Buffer[]) {
            const s = b.toString();
            const i = s.indexOf('=');
            if (i > 0) kv[s.slice(0, i).toLowerCase()] = s.slice(i + 1);
          }
          instTxt.set(a.name, { ...(instTxt.get(a.name) ?? {}), ...kv });
        }
      }
    });
    mdns.on('error', () => undefined);
    mdns.query(SERVICES.map((name) => ({ name, type: 'PTR' as const })));
    setTimeout(() => {
      for (const [inst, svc] of instSvc) {
        const ip = hostToIp.get(instHost.get(inst) ?? '') ?? instFrom.get(inst);
        if (!ip) continue;
        const txt = instTxt.get(inst) ?? {};
        const cur = found.get(ip) ?? { via: [] };
        found.set(ip, {
          ...cur,
          ip,
          name: cur.name ?? inst.replace(/\._.*$/, ''),
          model: cur.model ?? (txt.ty || txt.product?.replace(/[()]/g, '')),
          ipp: cur.ipp || svc.startsWith('_ipp'),
          via: [...new Set([...(cur.via ?? []), 'mdns'])],
        });
      }
      mdns.destroy();
      resolve(found);
    }, timeoutMs);
  });
}

/** Sub-redes IPv4 locais (/24 em volta de cada interface). */
function localSubnets(): string[] {
  const out = new Set<string>();
  for (const [ifname, addrs] of Object.entries(os.networkInterfaces())) {
    if (/^(docker|br-|veth|virbr|cni|flannel|tailscale|wg|tun)/.test(ifname)) continue; // redes virtuais
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('172.17.') || a.address.startsWith('169.254.')) continue; // docker0 / link-local
      out.add(a.address.split('.').slice(0, 3).join('.'));
    }
  }
  return [...out];
}

async function scan9100(): Promise<string[]> {
  const ips = localSubnets().flatMap((p) => Array.from({ length: 254 }, (_, i) => `${p}.${i + 1}`));
  const hits: string[] = [];
  const queue = [...ips];
  await Promise.all(
    Array.from({ length: 96 }, async () => {
      for (let ip = queue.shift(); ip; ip = queue.shift()) if (await probePort(ip, 9100, 700)) hits.push(ip);
    }),
  );
  return hits;
}

const OID_SYSDESCR = '1.3.6.1.2.1.1.1.0';
const OID_HRDEVICE = '1.3.6.1.2.1.25.3.2.1.3.1';
const OID_PRINTER_STATUS = '1.3.6.1.2.1.25.3.5.1.1.1';
const PRINTER_STATUS: Record<number, string> = { 1: 'outro', 2: 'desconhecido', 3: 'ociosa', 4: 'imprimindo', 5: 'aquecendo' };

export function snmpInfo(ip: string, timeoutMs = 1500): Promise<{ descr?: string; device?: string; status?: string } | undefined> {
  return new Promise((resolve) => {
    const session = snmp.createSession(ip, 'public', { timeout: timeoutMs, retries: 0 });
    session.get([OID_SYSDESCR, OID_HRDEVICE, OID_PRINTER_STATUS], (err: Error, vbs: any[]) => {
      session.close();
      if (err) return resolve(undefined);
      const val = (i: number) => (vbs[i] && !snmp.isVarbindError(vbs[i]) ? vbs[i].value : undefined);
      resolve({
        descr: val(0)?.toString(),
        device: val(1)?.toString(),
        status: val(2) !== undefined ? (PRINTER_STATUS[Number(val(2))] ?? String(val(2))) : undefined,
      });
    });
    session.on('error', () => resolve(undefined));
  });
}

/** MAC pela tabela ARP do host (preenchida pela própria varredura). */
function arpTable(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    for (const line of fs.readFileSync('/proc/net/arp', 'utf8').split('\n').slice(1)) {
      const [ip, , , mac] = line.trim().split(/\s+/);
      if (ip && mac && mac !== '00:00:00:00:00:00') map.set(ip, mac.toLowerCase());
    }
  } catch {
    /* fora do Linux */
  }
  return map;
}

const isBrotherQL = (s?: string) => !!s && /brother/i.test(s) && /\bQL[- ]?\d/i.test(s);

export async function discoverPrinters(): Promise<FoundPrinter[]> {
  const [mdns, hits] = await Promise.all([mdnsBrowse(), scan9100()]);
  const all = new Map<string, Partial<FoundPrinter>>(mdns);
  for (const ip of hits) {
    const cur = all.get(ip) ?? { ip, via: [] };
    all.set(ip, { ...cur, port9100: true, via: [...new Set([...(cur.via ?? []), '9100'])] });
  }
  const arp = arpTable();
  const result = await Promise.all(
    [...all.values()].map(async (p): Promise<FoundPrinter> => {
      const ip = p.ip!;
      const [info, port9100] = await Promise.all([snmpInfo(ip), p.port9100 ? Promise.resolve(true) : probePort(ip, 9100)]);
      const model = p.model ?? info?.device ?? info?.descr?.split(/[;,]/)[0];
      const text = `${model ?? ''} ${info?.descr ?? ''} ${p.name ?? ''}`;
      return {
        ip,
        mac: arp.get(ip),
        name: p.name,
        model: model?.trim(),
        brand: /brother/i.test(text) ? 'brother' : 'other',
        isBrotherQL: isBrotherQL(text),
        port9100,
        ipp: !!p.ipp,
        status: info?.status,
        via: [...(p.via ?? []), ...(info ? ['snmp'] : [])],
      };
    }),
  );
  return result.sort((a, b) => Number(b.isBrotherQL) - Number(a.isBrotherQL) || a.ip.localeCompare(b.ip, undefined, { numeric: true }));
}

/** Reencontra uma impressora vinculada cujo IP mudou (procura pelo MAC ou pelo nome mDNS). */
export async function relocate(target: { mac?: string; name?: string }): Promise<string | undefined> {
  if (!target.mac && !target.name) return undefined;
  const found = await discoverPrinters();
  return found.find((f) => (target.mac && f.mac === target.mac) || (target.name && f.name === target.name))?.ip;
}
