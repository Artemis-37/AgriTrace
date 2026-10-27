import { createRequire } from 'node:module';
const require = createRequire('/home/claude/agritrace-github/web/package.json');
const { chromium } = require('playwright-core');
import fs from 'node:fs';
const [,, a, b, step='1'] = process.argv; // frames a..b ; ou 'T:12.5' pour une seule image
const br = await chromium.launch({args:['--no-sandbox','--allow-file-access-from-files']});
const pg = await (await br.newContext({viewport:{width:1280,height:720}})).newPage();
await pg.goto('file:///tmp/promo2/index.html'); await pg.waitForTimeout(800);
if (a.startsWith('T:')) { for (const t of a.slice(2).split(',')) { await pg.evaluate(t=>render(t),+t); await pg.screenshot({path:`/tmp/promo2/t_${t}.png`}); } }
else { fs.mkdirSync('/tmp/promo2/frames',{recursive:true}); for (let f=+a; f<+b; f+=+step) { await pg.evaluate(t=>render(t), f/30); await pg.screenshot({path:`/tmp/promo2/frames/${String(f).padStart(5,'0')}.jpg`,type:'jpeg',quality:92}); } }
console.log('TOTAL', await pg.evaluate(()=>TOTAL));
await br.close();
