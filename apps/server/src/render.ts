/**
 * HTML da etiqueta → PDF com o MESMO motor do app original (iText html2pdf 2.1.3, processo Java persistente
 * em apps/renderer) → PNG 300 dpi via pdftoppm (para a Brother QL). Ver ADR-005.
 */
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { env } from './env.js';
import { logger } from './log.js';
import type { TicketDef } from './templates.js';

const execFileP = promisify(execFile);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkp-render-'));

let proc: ChildProcessWithoutNullStreams | undefined;
let ready: Promise<void> | undefined;
let seq = 0;
const pending = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();

function startRenderer(): Promise<void> {
  if (ready) return ready;
  const cp = [path.join(env.rendererDir, 'build'), path.join(env.rendererDir, 'lib', '*')].join(path.delimiter);
  const p = spawn(env.javaBin, ['-Xmx256m', '-Djava.awt.headless=true', '-cp', cp, 'RenderServer', path.join(env.vendorTemplatesDir, 'fonts')]);
  proc = p;
  ready = new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: p.stdout });
    rl.on('line', (line) => {
      if (line === 'READY') return resolve();
      const [id, status, msg] = line.split('\t');
      const job = pending.get(id);
      if (!job) return;
      pending.delete(id);
      if (status === 'OK') job.resolve();
      else job.reject(new Error(`Renderização falhou: ${msg}`));
    });
    p.stderr.on('data', (d) => logger.warn(`renderer: ${String(d).trim().slice(0, 300)}`));
    p.on('error', (e) => reject(new Error(`Não foi possível iniciar o Java (${env.javaBin}): ${e.message}`)));
    p.on('exit', (code) => {
      logger.warn(`Renderizador Java saiu (código ${code}).`);
      for (const j of pending.values()) j.reject(new Error('Renderizador reiniciado.'));
      pending.clear();
      proc = undefined;
      ready = undefined;
    });
  });
  return ready;
}

/** Tamanho da página em pontos tipográficos (Ticket.getWidth/getHeight do original). */
export const pageSizePt = (t: Pick<TicketDef, 'width' | 'height'>) => ({ w: t.width * 3, h: t.height * 3 });

export async function renderPdf(html: string, t: TicketDef): Promise<Buffer> {
  await startRenderer();
  const id = String(++seq);
  const htmlFile = path.join(tmpDir, `${id}.html`);
  const pdfFile = path.join(tmpDir, `${id}.pdf`);
  fs.writeFileSync(htmlFile, html);
  const { w, h } = pageSizePt(t);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Renderização demorou demais.'));
      }, 30_000);
      pending.set(id, {
        resolve: () => (clearTimeout(timer), resolve()),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      proc!.stdin.write(`${id}\t${w}\t${h}\t${htmlFile}\t${pdfFile}\n`);
    });
    return fs.readFileSync(pdfFile);
  } finally {
    fs.rmSync(htmlFile, { force: true });
    fs.rmSync(pdfFile, { force: true });
  }
}

/** Primeira página do PDF em PNG (padrão 300 dpi, a resolução da QL-810W). */
export async function pdfToPng(pdf: Buffer, dpi = 300): Promise<Buffer> {
  const base = path.join(tmpDir, `p${++seq}`);
  fs.writeFileSync(`${base}.pdf`, pdf);
  try {
    await execFileP(env.pdftoppmBin, ['-r', String(dpi), '-png', '-singlefile', '-f', '1', '-l', '1', `${base}.pdf`, base]);
    return fs.readFileSync(`${base}.png`);
  } finally {
    fs.rmSync(`${base}.pdf`, { force: true });
    fs.rmSync(`${base}.png`, { force: true });
  }
}

export async function renderPng(html: string, t: TicketDef, dpi = 300): Promise<Buffer> {
  return pdfToPng(await renderPdf(html, t), dpi);
}

export async function closeRenderer(): Promise<void> {
  proc?.stdin.end();
  proc?.kill();
}
