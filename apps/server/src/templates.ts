/**
 * Catálogo de modelos de etiqueta e preenchimento — porte de PDFDocument.generateHTML/getHtmlString
 * e RequestFile do MyKids Printer 1.3.5.
 */
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { env } from './env.js';
import { getAccount } from './gileade.js';
import { logger } from './log.js';

export interface TicketDef {
  type: string; // nome usado no MyKids/original (ex.: BROTHER28X80, BROTHER62X100P)
  description: string;
  width: number; // "mm" do original (página PDF = valor * 3 pt)
  height: number;
  source: 'builtin' | 'online';
  file: string;
}

/** Modelos HTML embutidos no app original (ticket/*.java). ZPL/PPLA ficam de fora: alvo é Brother/IPP. */
const BUILTIN: Omit<TicketDef, 'source' | 'file'>[] = [
  { type: 'BROTHER28X80', description: 'Brother 29x90 (padrão)', width: 80, height: 28 },
  { type: 'BROTHER28X80VERTICAL', description: 'Brother 29x90 vertical', width: 28, height: 80 },
  { type: 'BROTHER28X80DATAHORA', description: 'Brother 29x90 com data/hora', width: 80, height: 28 },
  { type: 'BROTHER60X100', description: 'Brother 60x100', width: 100, height: 60 },
  { type: 'BROTHER62X100', description: 'Brother 62x100', width: 100, height: 62 },
  { type: 'VOLUTSBROTHER28X80', description: 'Voluts 29x90', width: 80, height: 28 },
  { type: 'VOLUTSBROTHER60X100', description: 'Voluts 60x100', width: 100, height: 60 },
  { type: 'VOLUTSBROTHER62X100', description: 'Voluts 62x100', width: 100, height: 62 },
  { type: 'PDF', description: 'PDF genérico 62x100', width: 100, height: 62 },
  { type: 'PULSEIRAPDF', description: 'Pulseira (PDF)', width: 289, height: 25 },
  { type: 'ARGOX20X80', description: 'Argox 20x80 (PDF)', width: 70, height: 20 },
  { type: 'ARGOX30X80', description: 'Argox 30x80 (PDF)', width: 80, height: 30 },
];

const onlineDir = (oi: string) => path.join(env.dataDir, 'templates', oi.replace(/[^0-9.]/g, ''));

/** Baixa values.json + HTMLs da organização no S3 (como OnlineTemplate.java), com cache em disco. */
export async function refreshOnlineTemplates(): Promise<TicketDef[]> {
  const oi = getAccount()?.oi;
  if (!oi) return [];
  const dir = onlineDir(oi);
  fs.mkdirSync(dir, { recursive: true });
  const base = `${env.templatesBase}${oi}/templates/`;
  try {
    const res = await fetch(base + 'values.json', { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`values.json HTTP ${res.status}`);
    const values = await res.text();
    JSON.parse(values);
    fs.writeFileSync(path.join(dir, 'values.json'), values);
    for (const t of JSON.parse(values).templates ?? []) {
      const r = await fetch(base + t.file, { signal: AbortSignal.timeout(15_000) });
      if (r.ok) fs.writeFileSync(path.join(dir, path.basename(t.file)), await r.text());
    }
    logger.info(`Modelos online da organização ${oi} atualizados.`);
  } catch (e) {
    logger.warn(`Sem modelos online (usando cache): ${(e as Error).message}`);
  }
  return onlineTemplates();
}

function onlineTemplates(): TicketDef[] {
  const oi = getAccount()?.oi;
  if (!oi) return [];
  const file = path.join(onlineDir(oi), 'values.json');
  if (!fs.existsSync(file)) return [];
  const values = JSON.parse(fs.readFileSync(file, 'utf8'));
  return (values.templates ?? []).map((t: any) => ({
    type: String(t.file).split('.')[0],
    description: t.description ?? t.file,
    width: t.dimension?.width ?? 100,
    height: t.dimension?.height ?? 62,
    source: 'online' as const,
    file: path.join(onlineDir(oi), path.basename(t.file)),
  }));
}

function builtinTemplates(): TicketDef[] {
  return BUILTIN.map((t) => ({ ...t, source: 'builtin' as const, file: path.join(env.vendorTemplatesDir, 'printers', `${t.type}.html`) })).filter(
    (t) => fs.existsSync(t.file),
  );
}

export function listTemplates(): TicketDef[] {
  return [...onlineTemplates(), ...builtinTemplates()];
}

export function getTemplate(type: string): TicketDef | undefined {
  return listTemplates().find((t) => t.type === type);
}

// ---------------------------------------------------------------- dados do pedido (RequestFile)

export interface PrintRequest {
  codigo: string;
  primeiroNome: string;
  ultimoNome: string;
  idade?: number | null;
  sala: string;
  QRCodeData: string;
  printerId: string;
  visitante: boolean;
  atencao: boolean;
  necessidadesEspeciais: boolean;
  aceitoUsoImagem: boolean;
  fazAniversarioNaSemana: boolean;
  passeLivre: boolean;
  data?: string | null;
  dataPattern?: string | null;
  adicional?: { chave: string; valor: string }[] | null;
  origin?: string | null;
  nomeEvento?: string | null;
}

const strip = (s: unknown) => (typeof s === 'string' ? s.normalize('NFD').replace(/[̀-ͯ]/g, '') : '');
const bool = (v: unknown) => v === true;

/** Normaliza um item do evento "print" do Socket.IO (mesmas regras do construtor RequestFile(JSONObject)). */
export function parsePrintRequest(m: any): PrintRequest {
  return {
    codigo: String(m.codigo ?? ''),
    primeiroNome: strip(m.primeiroNome),
    ultimoNome: strip(m.ultimoNome),
    idade: typeof m.idade === 'number' ? m.idade : null,
    sala: strip(m.sala),
    QRCodeData: String(m.QRCodeData ?? ''),
    printerId: String(m.printerId ?? ''),
    visitante: bool(m.visitante),
    atencao: bool(m.atencao),
    necessidadesEspeciais: bool(m.necessidadesEspeciais),
    aceitoUsoImagem: bool(m.aceitoUsoImagem),
    fazAniversarioNaSemana: bool(m.fazAniversarioNaSemana),
    passeLivre: bool(m.passeLivre),
    data: m.data ?? null,
    dataPattern: m.dataPattern ?? null,
    adicional: Array.isArray(m.adicional) ? m.adicional.map((a: any) => ({ chave: String(a.chave), valor: String(a.valor) })) : null,
    origin: m.origin ?? null,
    nomeEvento: m.nomeEvento ?? null,
  };
}

/** Dados fictícios para impressão de teste (os mesmos defaults do RequestFile original). */
export function samplePrintRequest(printerId: string): PrintRequest {
  return {
    codigo: '232',
    primeiroNome: 'FERNANDA',
    ultimoNome: 'OLIVEIRA',
    idade: 1,
    sala: 'BERCARIO',
    QRCodeData: '1234567890|1234567890|1234567890|31122016|A',
    printerId,
    visitante: true,
    atencao: true,
    necessidadesEspeciais: true,
    aceitoUsoImagem: true,
    fazAniversarioNaSemana: true,
    passeLivre: true,
    data: null,
    adicional: [
      { chave: 'Responsavel', valor: 'Maria' },
      { chave: 'Telefone', valor: '(19) 99999-0000' },
    ],
  };
}

const two = (n: number) => String(n).padStart(2, '0');

/** dd/MM/yy; se vier dataPattern, o texto de "data" já vem formatado pelo MyKids. */
export function formatData(r: PrintRequest, now = new Date()): string {
  if (r.data && r.dataPattern) return r.data;
  const d = r.data ? new Date(r.data) : now;
  const date = Number.isNaN(d.getTime()) ? now : d;
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${String(date.getFullYear()).slice(-2)}`;
}

const adicionalHtml = (r: PrintRequest) =>
  (r.adicional ?? []).map((v) => `<span class='adicional1'>${v.chave}</span><span class='adicional2'>${v.valor}</span>`).join('<br>');

const rep = (html: string, key: string, value: string) => html.split(key).join(value);

/** Preenche o HTML com os dados — mesma ordem de substituição do original (chaves mais longas primeiro). */
export async function fillTemplate(html: string, r: PrintRequest, ticketType: string, logo?: string): Promise<string> {
  const qr = await QRCode.toDataURL(r.QRCodeData || ' ', { width: 250, margin: 0 });
  const on = (b: boolean) => (b ? 'inline-block' : 'none');
  html = rep(html, '$qrcode', qr);
  html = rep(html, '$primeiroNome', r.primeiroNome);
  if (logo) html = rep(html, '$logo', logo);
  if (r.nomeEvento) html = rep(html, '$nomeEvento', r.nomeEvento);
  html = rep(html, '$ultimoNome', r.ultimoNome);

  if (ticketType === 'PULSEIRAPDF') {
    html = rep(html, '$visitante', r.visitante ? '*' : '&nbsp;');
    html = rep(html, '$atencao', r.atencao ? '(!)' : '&nbsp;');
    html = rep(html, '$necessidadesIcone', on(r.necessidadesEspeciais));
    html = rep(html, '$autorizaUsoImagem', r.aceitoUsoImagem ? '#' : '&nbsp;');
    html = rep(html, '$passeLivre', r.passeLivre ? '[>' : '&nbsp;');
    html = rep(html, '$fazAniversarioNaSemanaIcone', r.fazAniversarioNaSemana ? 'block' : 'none');
    html = rep(html, '$fazAniversarioNaSemana', r.fazAniversarioNaSemana ? 'a' : '&nbsp;');
  } else {
    html = rep(html, '$visitanteIcone', on(r.visitante));
    html = rep(html, '$visitante', r.visitante ? '*' : '&nbsp;');
    html = rep(html, '$atencaoIcone', on(r.atencao));
    html = rep(html, '$fazAniversarioNaSemanaIcone', on(r.fazAniversarioNaSemana));
    html = rep(html, '$necessidadesIcone', on(r.necessidadesEspeciais));
    html = rep(html, '$autorizaUsoImagemIcone', on(r.aceitoUsoImagem));
    if (ticketType === 'BROTHER62X100' || ticketType === 'BROTHER62X100P') {
      html = rep(html, '$atencao', on(r.atencao));
      html = rep(html, '$fazAniversarioNaSemana', on(r.fazAniversarioNaSemana));
    } else if (ticketType !== 'BROTHER60X100') {
      html = rep(html, '$atencao', r.atencao ? '(!)' : '&nbsp;');
      html = rep(html, '$fazAniversarioNaSemana', r.fazAniversarioNaSemana ? 'a' : '&nbsp;');
    } else {
      html = rep(html, '$atencao', r.atencao ? '(!)' : 'none');
      html = rep(html, '$fazAniversarioNaSemana', r.fazAniversarioNaSemana ? 'a' : 'none');
    }
    html = rep(html, '$necessidadesEspeciais', r.necessidadesEspeciais ? 'e' : '&nbsp;');
    html = rep(html, '$autorizaUsoImagem', r.aceitoUsoImagem ? '#' : '&nbsp;');
    html = rep(html, '$passeLivreIcone', on(r.passeLivre));
    html = rep(html, '$passeLivre', r.passeLivre ? '[>' : '&nbsp;');
  }
  html = rep(html, '$codigo', r.codigo);
  html = rep(html, '$sala', r.sala);
  html = rep(html, '$data', formatData(r));
  return rep(html, '$adicional', adicionalHtml(r));
}

/** HTML do modelo para um pedido; pedidos de origem VOLUTS usam a variante VOLUTS (regra do original). */
export function resolveTemplate(ticketType: string, r: PrintRequest): TicketDef | undefined {
  if (r.origin === 'VOLUTS' && !ticketType.startsWith('VOLUTS')) {
    const v = getTemplate(`VOLUTS${ticketType}`);
    if (v) return v;
  }
  return getTemplate(ticketType);
}

export function volutsLogo(): string | undefined {
  const f = path.join(env.vendorTemplatesDir, 'voluts-logo.txt');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : undefined;
}
