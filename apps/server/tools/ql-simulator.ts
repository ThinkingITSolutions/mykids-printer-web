/**
 * Simulador de Brother QL-810W: escuta TCP (padrão 9100), decodifica o Brother Raster recebido
 * e salva cada etiqueta como PNG — permite testar sem a impressora física.
 * Uso: pnpm --filter server simulator [porta] [pasta-saida]
 */
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { decodeRaster, rasterPageToPng } from '../src/brother.js';

const port = Number(process.argv[2] ?? 9100);
const outDir = path.resolve(process.argv[3] ?? './data/simulator');
fs.mkdirSync(outDir, { recursive: true });
let n = 0;

net
  .createServer((sock) => {
    const chunks: Buffer[] = [];
    sock.on('data', (c) => chunks.push(c));
    sock.on('end', async () => {
      try {
        const pages = decodeRaster(Buffer.concat(chunks));
        for (const p of pages) {
          const file = path.join(outDir, `etiqueta-${String(++n).padStart(4, '0')}.png`);
          fs.writeFileSync(file, await rasterPageToPng(p.lines));
          const m = p.media ?? [];
          console.log(`etiqueta ${n}: ${p.lines.length} linhas, mídia ${m[2]}x${m[3]} mm (tipo 0x${m[1]?.toString(16)}) → ${file}`);
        }
      } catch (e) {
        console.error('job inválido:', (e as Error).message);
      }
    });
  })
  .listen(port, () => console.log(`Simulador QL-810W ouvindo em :${port}, salvando em ${outDir}`));
