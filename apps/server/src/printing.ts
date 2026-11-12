/** Pipeline: pedidos do MyKids → modelo HTML → PNG/PDF → impressora vinculada (com fila por impressora). */
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.js';
import { db } from './db.js';
import { logger, log } from './log.js';
import { fillTemplate, resolveTemplate, volutsLogo, type PrintRequest } from './templates.js';
import { renderPdf, renderPng } from './render.js';
import { getLabel, pngToRaster } from './brother.js';
import { sendRaw, ippPrintPdf } from './transports.js';
import { relocate } from './discovery.js';
import { getPrinterByMyKidsId, updateTargetHost, type PrinterRow } from './printers.js';

const previewDir = path.join(env.dataDir, 'previews');
fs.mkdirSync(previewDir, { recursive: true });

export const previewPath = (printerId: number) => path.join(previewDir, `printer-${printerId}.png`);

/** Filas por impressora: pedidos da mesma impressora saem em ordem, um job por vez. */
const queues = new Map<number, Promise<void>>();

function recordJob(p: PrinterRow, codigo: string | null, status: string, labels: number, ms: number, source: string, detail?: string) {
  db.prepare(
    'INSERT INTO jobs (mykids_id, printer_name, codigo, status, detail, labels, duration_ms, source) VALUES (?,?,?,?,?,?,?,?)',
  ).run(p.mykidsId, p.nickname, codigo, status, detail ?? null, labels, ms, source);
}

async function renderLabels(printer: PrinterRow, requests: PrintRequest[]) {
  const pngs: Buffer[] = [];
  const pdfs: Buffer[] = [];
  for (const r of requests) {
    const t = resolveTemplate(printer.ticketType, r);
    if (!t) throw new Error(`Modelo "${printer.ticketType}" não encontrado.`);
    const html = await fillTemplate(fs.readFileSync(t.file, 'utf8'), r, t.type, r.origin ? volutsLogo() : undefined);
    if (printer.target.kind === 'ipp') pdfs.push(await renderPdf(html, t));
    else pngs.push(await renderPng(html, t));
  }
  return { pngs, pdfs };
}

const isNetworkError = (e: any) => ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'EHOSTDOWN'].includes(e?.code) || /tempo esgotado/.test(e?.message);

async function deliver(printer: PrinterRow, pngs: Buffer[], pdfs: Buffer[]) {
  const t = printer.target;
  const inverse = printer.orientation.startsWith('INVERSE');
  switch (t.kind) {
    case 'preview': {
      if (pngs[0]) fs.writeFileSync(previewPath(printer.id), pngs[pngs.length - 1]);
      return;
    }
    case 'brother-ql': {
      const label = getLabel(t.label ?? '29x90');
      if (!label) throw new Error(`Etiqueta Brother desconhecida: ${t.label}`);
      if (!t.host) throw new Error('Impressora sem endereço.');
      const job = await pngToRaster(pngs, { label, inverse, threshold: t.threshold });
      fs.writeFileSync(previewPath(printer.id), pngs[pngs.length - 1]);
      await sendRaw(t.host, job, t.port ?? 9100);
      return;
    }
    case 'ipp': {
      if (!t.host) throw new Error('Impressora sem endereço.');
      const url = `ipp://${t.host}:${t.port ?? 631}/${t.ippPath ?? 'ipp/print'}`;
      for (const pdf of pdfs) await ippPrintPdf(url, pdf);
      return;
    }
  }
}

async function printNow(printer: PrinterRow, requests: PrintRequest[]): Promise<void> {
  const { pngs, pdfs } = await renderLabels(printer, requests);
  try {
    await deliver(printer, pngs, pdfs);
  } catch (e) {
    if (!isNetworkError(e) || printer.target.kind === 'preview') throw e;
    // IP mudou? procura a impressora pelo MAC/nome e tenta de novo.
    logger.warn(`"${printer.nickname}" não respondeu em ${printer.target.host}; procurando na rede...`, 'impressao');
    const ip = await relocate(printer.target);
    if (!ip || ip === printer.target.host) throw e;
    updateTargetHost(printer.id, ip);
    logger.info(`"${printer.nickname}" reencontrada em ${ip} (IP mudou).`, 'impressao');
    await deliver({ ...printer, target: { ...printer.target, host: ip } }, pngs, pdfs);
  }
}

/** Enfileira e imprime. Resolve quando o job termina (ou rejeita com o erro). */
export function enqueue(printer: PrinterRow, requests: PrintRequest[], source: 'checkin' | 'teste', actor?: string): Promise<void> {
  const prev = queues.get(printer.id) ?? Promise.resolve();
  const run = prev
    .catch(() => undefined)
    .then(async () => {
      const codes = requests.map((r) => r.codigo).join(',');
      const t0 = Date.now();
      try {
        await printNow(printer, requests);
        const ms = Date.now() - t0;
        recordJob(printer, codes, 'ok', requests.length, ms, source);
        log('info', `Impresso em "${printer.nickname}": ${requests.length} etiqueta(s), código(s) ${codes}, ${ms} ms (${source}).`, 'impressao', actor);
      } catch (e) {
        const ms = Date.now() - t0;
        recordJob(printer, codes, 'erro', requests.length, ms, source, (e as Error).message);
        log('error', `Falha ao imprimir em "${printer.nickname}" (código(s) ${codes}, ${source}): ${(e as Error).message}`, 'impressao', actor);
        throw e;
      }
    });
  queues.set(printer.id, run);
  return run;
}

/** Entrada do Socket.IO: agrupa por printerId (o original mesclava os PDFs num job). */
export async function handlePrintEvent(requests: PrintRequest[]): Promise<void> {
  const byPrinter = new Map<string, PrintRequest[]>();
  for (const r of requests) byPrinter.set(r.printerId, [...(byPrinter.get(r.printerId) ?? []), r]);
  await Promise.allSettled(
    [...byPrinter].map(async ([mykidsId, reqs]) => {
      const printer = getPrinterByMyKidsId(mykidsId);
      if (!printer || !printer.enabled) {
        logger.warn(`Pedido para a impressora MyKids ${mykidsId}, que não está vinculada/ativa aqui (${reqs.length} etiqueta(s) ignorada(s)).`, 'impressao');
        return;
      }
      await enqueue(printer, reqs, 'checkin');
    }),
  );
}
