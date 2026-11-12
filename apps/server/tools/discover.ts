import { discoverPrinters } from '../src/discovery.js';
const t = Date.now();
console.log(JSON.stringify(await discoverPrinters(), null, 1));
console.log(`(${Date.now() - t} ms)`);
