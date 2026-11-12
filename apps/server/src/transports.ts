/** Envio para a impressora: TCP 9100 (raw/Brother Raster) e IPP (PDF). */
import net from 'node:net';
import ipp from 'ipp';

export function sendRaw(host: string, data: Buffer, port = 9100, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    const timer = setTimeout(() => sock.destroy(new Error(`tempo esgotado falando com ${host}:${port}`)), timeoutMs);
    sock.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    sock.once('connect', () => sock.end(data));
    sock.once('close', (hadError) => {
      clearTimeout(timer);
      if (!hadError) resolve();
    });
  });
}

/** Testa se a porta responde (usado na descoberta e no "reconectar"). */
export function probePort(host: string, port = 9100, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

function ippExecute(url: string, op: string, msg: object): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      ipp.Printer(url).execute(op, msg, (err: any, res: any) =>
        err ? reject(err instanceof Error ? err : new Error(`IPP: ${String(err)}`)) : resolve(res),
      );
    } catch (e) {
      // a lib "ipp" lança strings (ex.: atributo desconhecido)
      reject(e instanceof Error ? e : new Error(`IPP: ${String(e)}`));
    }
  });
}

export async function ippAttributes(url: string): Promise<Record<string, any>> {
  const res = await ippExecute(url, 'Get-Printer-Attributes', {
    'operation-attributes-tag': {
      'requested-attributes': ['printer-make-and-model', 'document-format-supported', 'printer-state', 'printer-state-reasons', 'media-supported'],
    },
  });
  return res['printer-attributes-tag'] ?? {};
}

export async function ippPrintPdf(url: string, pdf: Buffer, jobName = 'MyKids Printer'): Promise<void> {
  const res = await ippExecute(url, 'Print-Job', {
    'operation-attributes-tag': { 'requesting-user-name': 'mykids', 'job-name': jobName, 'document-format': 'application/pdf' },
    data: pdf,
  });
  if (!String(res.statusCode).startsWith('successful')) throw new Error(`IPP: ${res.statusCode}`);
}
