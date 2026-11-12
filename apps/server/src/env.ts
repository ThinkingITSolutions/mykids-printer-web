import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
fs.mkdirSync(dataDir, { recursive: true });

/** Chave mestra: usa APP_SECRET; se não houver, gera uma e guarda no volume de dados. */
function loadSecret(): Buffer {
  if (process.env.APP_SECRET) return crypto.createHash('sha256').update(process.env.APP_SECRET).digest();
  const file = path.join(dataDir, '.secret');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').trim()).digest();
}

export const env = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir,
  secret: loadSecret(),
  /** Pasta com os modelos HTML embutidos no app original (extraídos do jar oficial). */
  vendorTemplatesDir: path.resolve(process.env.VENDOR_TEMPLATES_DIR ?? '../../vendor-templates'),
  webDir: path.resolve(process.env.WEB_DIR ?? '../web/dist'),
  javaBin: process.env.JAVA_BIN ?? 'java',
  pdftoppmBin: process.env.PDFTOPPM_BIN ?? 'pdftoppm',
  /** Pasta do renderizador iText (build/ + lib/). */
  rendererDir: path.resolve(process.env.RENDERER_DIR ?? '../renderer'),
  gileadeApi: process.env.GILEADE_API ?? 'https://web.appmykids.com.br/gileadeweb-api/',
  socketUrl: process.env.MYKIDS_SOCKET_URL ?? 'http://printer.appmykids.com.br/',
  templatesBase:
    process.env.TEMPLATES_BASE ?? 'https://s3.sa-east-1.amazonaws.com/web.gileadesistemas.com.br/mykidsprinter/',
  /** HTTPS direto no app (opcional): caminhos do certificado e da chave PEM. */
  tlsCertFile: process.env.TLS_CERT_FILE,
  tlsKeyFile: process.env.TLS_KEY_FILE,
  secureCookies: process.env.SECURE_COOKIES === 'true' || !!(process.env.TLS_CERT_FILE && process.env.TLS_KEY_FILE),
};
