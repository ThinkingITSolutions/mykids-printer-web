/**
 * Codificador Brother QL Raster (QL-800/810W/820NWB), compatível com a referência open source brother_ql.
 * Saída = bytes para enviar em TCP 9100. Cabeça de 720 pontos (90 bytes/linha), 300 dpi.
 */
import sharp from 'sharp';

export interface LabelSpec {
  id: string;
  description: string;
  kind: 'continuous' | 'die-cut';
  widthMm: number;
  lengthMm: number; // 0 = contínua
  printable: [number, number]; // pontos (largura, comprimento; 0 = livre)
  offsetRight: number; // pontos de margem à direita da cabeça
  feedMargin: number;
}

/** Tabela de etiquetas (labels.py do brother_ql). */
export const LABELS: LabelSpec[] = [
  { id: '29x90', description: 'DK-11201 29x90 mm (cortada)', kind: 'die-cut', widthMm: 29, lengthMm: 90, printable: [306, 991], offsetRight: 6, feedMargin: 0 },
  { id: '62x100', description: 'DK-11202 62x100 mm (cortada)', kind: 'die-cut', widthMm: 62, lengthMm: 100, printable: [696, 1109], offsetRight: 12, feedMargin: 0 },
  { id: '62x29', description: 'DK-11209 62x29 mm (cortada)', kind: 'die-cut', widthMm: 62, lengthMm: 29, printable: [696, 271], offsetRight: 12, feedMargin: 0 },
  { id: '62', description: 'DK-22205 62 mm contínua', kind: 'continuous', widthMm: 62, lengthMm: 0, printable: [696, 0], offsetRight: 12, feedMargin: 35 },
  { id: '29', description: 'DK-22210 29 mm contínua', kind: 'continuous', widthMm: 29, lengthMm: 0, printable: [306, 0], offsetRight: 6, feedMargin: 35 },
];

export const getLabel = (id: string) => LABELS.find((l) => l.id === id);

const HEAD_DOTS = 720;
const LINE_BYTES = HEAD_DOTS / 8;

export interface RasterOptions {
  label: LabelSpec;
  /** Gira 180° (orientações "invertidas" do original). */
  inverse?: boolean;
  /** 0-255: abaixo disso vira preto. */
  threshold?: number;
  cut?: boolean;
}

/** Ajusta a imagem renderizada ao rolo: deita no sentido da alimentação, encaixa (contain) e binariza. */
export async function prepareBitmap(png: Buffer, opts: RasterOptions): Promise<{ width: number; height: number; bits: Uint8Array }> {
  const { label } = opts;
  const meta = await sharp(png).metadata();
  const landscape = (meta.width ?? 0) > (meta.height ?? 0);
  // O lado maior da etiqueta corre ao longo do papel: imagem deitada gira 90°.
  const angle = ((landscape ? 90 : 0) + (opts.inverse ? 180 : 0)) % 360;
  const [pw, ph] = label.printable;
  let img = sharp(png).flatten({ background: '#ffffff' }).rotate(angle);
  img =
    ph > 0
      ? img.resize({ width: pw, height: ph, fit: 'contain', background: '#ffffff' })
      : img.resize({ width: pw, fit: 'contain', background: '#ffffff' });
  const { data, info } = await img
    .greyscale()
    .threshold(opts.threshold ?? 160)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bits = new Uint8Array(info.width * info.height);
  for (let i = 0; i < bits.length; i++) bits[i] = data[i * info.channels] < 128 ? 1 : 0;
  return { width: info.width, height: info.height, bits };
}

/** Monta uma linha de 720 pontos: imagem espelhada e deslocada pela margem direita (como o brother_ql). */
function rasterLine(bits: Uint8Array, width: number, row: number, offsetRight: number): Buffer {
  const line = Buffer.alloc(LINE_BYTES);
  for (let x = 0; x < width; x++) {
    if (!bits[row * width + x]) continue;
    const col = offsetRight + (width - 1 - x); // espelhamento horizontal
    if (col < 0 || col >= HEAD_DOTS) continue;
    line[col >> 3] |= 0x80 >> (col & 7);
  }
  return line;
}

/** Gera o job completo (uma ou várias etiquetas). */
export function encodeRaster(pages: { width: number; height: number; bits: Uint8Array }[], opts: RasterOptions): Buffer {
  const { label } = opts;
  const out: Buffer[] = [];
  const push = (...b: (number[] | Buffer)[]) => b.forEach((x) => out.push(Buffer.isBuffer(x) ? x : Buffer.from(x)));

  push(Buffer.alloc(400)); // invalidate (QL-8xx usa 400 bytes nulos)
  push([0x1b, 0x40]); // initialize
  push([0x1b, 0x69, 0x61, 0x01]); // modo raster

  pages.forEach((page, i) => {
    const lines = page.height;
    const mediaType = label.kind === 'continuous' ? 0x0a : 0x0b;
    const flags = 0x80 | 0x02 | 0x04 | (label.lengthMm ? 0x08 : 0);
    const rn = Buffer.alloc(4);
    rn.writeUInt32LE(lines);
    push([0x1b, 0x69, 0x7a, flags, mediaType, label.widthMm, label.lengthMm], rn, [i === 0 ? 0 : 1, 0x00]); // media/qualidade
    push([0x1b, 0x69, 0x4d, opts.cut === false ? 0x00 : 0x40]); // autocorte
    push([0x1b, 0x69, 0x41, 0x01]); // cortar a cada 1 etiqueta
    push([0x1b, 0x69, 0x4b, opts.cut === false ? 0x00 : 0x08]); // modo expandido: cortar no fim
    push([0x1b, 0x69, 0x64, label.feedMargin & 0xff, label.feedMargin >> 8]); // margem
    push([0x4d, 0x00]); // sem compressão
    for (let y = 0; y < lines; y++) {
      push([0x67, 0x00, LINE_BYTES], rasterLine(page.bits, page.width, y, label.offsetRight));
    }
    push([i === pages.length - 1 ? 0x1a : 0x0c]); // imprimir (0x1A última / 0x0C próxima)
  });
  return Buffer.concat(out);
}

export async function pngToRaster(pngs: Buffer[], opts: RasterOptions): Promise<Buffer> {
  const pages = [];
  for (const png of pngs) pages.push(await prepareBitmap(png, opts));
  return encodeRaster(pages, opts);
}

/** Decodificador (para o simulador e testes): devolve as páginas como bitmaps 720 x N. */
export function decodeRaster(buf: Buffer): { lines: Uint8Array[]; media?: number[] }[] {
  const pages: { lines: Uint8Array[]; media?: number[] }[] = [];
  let cur: { lines: Uint8Array[]; media?: number[] } = { lines: [] };
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    if (b === 0x00) { i++; continue; }
    if (b === 0x1b) {
      const c = buf[i + 1];
      if (c === 0x40) { i += 2; continue; }
      if (c === 0x69) {
        const d = buf[i + 2];
        if (d === 0x7a) { cur.media = [...buf.subarray(i + 3, i + 13)]; i += 13; continue; }
        if (d === 0x64) { i += 5; continue; }
        if (d === 0x53) { i += 3; continue; }
        i += 4; // a, M, A, K: 1 byte de argumento
        continue;
      }
      throw new Error(`comando ESC desconhecido 0x${c?.toString(16)} em ${i}`);
    }
    if (b === 0x4d) { i += 2; continue; }
    if (b === 0x67) {
      const len = buf[i + 2];
      cur.lines.push(Uint8Array.from(buf.subarray(i + 3, i + 3 + len)));
      i += 3 + len;
      continue;
    }
    if (b === 0x5a) { cur.lines.push(new Uint8Array(LINE_BYTES)); i++; continue; } // linha em branco
    if (b === 0x0c || b === 0x1a) { pages.push(cur); cur = { lines: [] }; i++; continue; }
    throw new Error(`byte inesperado 0x${b.toString(16)} em ${i}`);
  }
  return pages;
}

/** Converte uma página decodificada em PNG (desfaz o espelhamento) — para pré-visualização. */
export async function rasterPageToPng(lines: Uint8Array[]): Promise<Buffer> {
  const h = lines.length;
  const px = Buffer.alloc(HEAD_DOTS * h, 255);
  lines.forEach((line, y) => {
    for (let col = 0; col < HEAD_DOTS; col++) {
      if (line[col >> 3] & (0x80 >> (col & 7))) px[y * HEAD_DOTS + (HEAD_DOTS - 1 - col)] = 0;
    }
  });
  return sharp(px, { raw: { width: HEAD_DOTS, height: h, channels: 1 } }).png().toBuffer();
}
