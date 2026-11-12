import { ippAttributes } from '../src/transports.js';
for (const path of ['ipp/print', 'ipp/printer', '']) {
  try { const a = await ippAttributes(`ipp://${process.argv[2] ?? '127.0.0.1'}:631/${path}`); console.log(path, JSON.stringify(a).slice(0, 900)); break; }
  catch (e) { console.log(path, 'ERR', (e as Error).message); }
}
