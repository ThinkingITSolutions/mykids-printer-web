// Renderiza um modelo com dados fictícios → PNG/PDF → Brother Raster → decodifica → PNG (round trip).
import fs from 'node:fs';
import { fillTemplate, samplePrintRequest, type TicketDef } from '../src/templates.js';
import { renderPng, renderPdf, closeRenderer } from '../src/render.js';
import { getLabel, pngToRaster, decodeRaster, rasterPageToPng } from '../src/brother.js';
const [file, type, w, h, labelId, out] = process.argv.slice(2);
const t: TicketDef = { type, description: type, width: +w, height: +h, source: 'online', file };
const html = await fillTemplate(fs.readFileSync(file, 'utf8'), samplePrintRequest('1'), type);
fs.writeFileSync(`${out}.html`, html);
const png = await renderPng(html, t);
fs.writeFileSync(`${out}-render.png`, png);
fs.writeFileSync(`${out}.pdf`, await renderPdf(html, t));
const raster = await pngToRaster([png], { label: getLabel(labelId)! });
const pages = decodeRaster(raster);
fs.writeFileSync(`${out}-raster.png`, await rasterPageToPng(pages[0].lines));
console.log(`raster ${raster.length} bytes, ${pages.length} pág., ${pages[0].lines.length} linhas, mídia ${pages[0].media}`);
await closeRenderer();
