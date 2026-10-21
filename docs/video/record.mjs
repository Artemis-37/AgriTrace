// Enregistre les scènes « live » : le vrai portail piloté pas à pas (curseur visible), au rythme de la narration.
// Prérequis : API démarrée + portail servi sur WEB (voir README.md), comptes de démo dans /tmp/demo-accounts.json.
// Usage : node record.mjs [id ...]   (sans argument : toutes les scènes live)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'package.json'));
const { chromium } = require('playwright-core');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = process.env.WEB ?? 'http://127.0.0.1:4173';
const OUT = path.join(HERE, 'build', 'live'); fs.mkdirSync(OUT, { recursive: true });
const scenes = JSON.parse(fs.readFileSync(path.join(HERE, 'scenario.json'), 'utf8'));
const durs = JSON.parse(fs.readFileSync(path.join(HERE, 'build', 'durations.json'), 'utf8'));
const demo = JSON.parse(fs.readFileSync(process.env.DEMO_JSON ?? '/tmp/demo-accounts.json', 'utf8'));
const only = new Set(process.argv.slice(2));
const VIEW = { width: 1600, height: 950 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });

const CURSOR = () => {
  const make = () => {
    if (document.getElementById('__cur') || !document.body) return;
    const c = document.createElement('div'); c.id = '__cur';
    c.style.cssText = 'position:fixed;z-index:2147483647;width:26px;height:26px;border-radius:50%;background:rgba(255,90,60,.5);border:3px solid #fff;pointer-events:none;left:-60px;top:-60px;transition:transform .08s;box-shadow:0 0 10px rgba(0,0,0,.5)';
    document.body.appendChild(c);
    window.addEventListener('mousemove', (e) => { c.style.left = e.clientX - 13 + 'px'; c.style.top = e.clientY - 13 + 'px'; }, true);
    window.addEventListener('mousedown', () => { c.style.transform = 'scale(.6)'; }, true);
    window.addEventListener('mouseup', () => { c.style.transform = 'scale(1)'; }, true);
  };
  document.addEventListener('DOMContentLoaded', make); make();
};

async function login(page, role) {
  const a = demo.accounts.find((x) => x.role === role); if (!a) throw new Error('compte introuvable : ' + role);
  await page.goto(WEB + '/'); await page.fill('input[type=email]', a.email); await page.fill('input[type=password]', demo.password); await page.click('button[type=submit]'); await page.waitForTimeout(1500);
  if (await page.locator('.org-list button').count()) { await page.locator('.org-list button').first().click(); await page.waitForTimeout(1200); }
}

async function moveTo(page, loc) {
  const box = await loc.boundingBox(); if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 28 });
}

async function act(page, s) {
  if (s.goto) { await page.goto(WEB + s.goto); await page.waitForTimeout(700); }
  else if (s.tab) { const l = page.locator(`[role=tab]:has-text("${s.tab}")`).first(); await l.waitFor({ timeout: 9000 }); await moveTo(page, l); await l.click(); }
  else if (s.click) { const l = page.locator(s.click).first(); await l.waitFor({ timeout: 9000 }); await l.scrollIntoViewIfNeeded(); await moveTo(page, l); await sleep(250); await l.click(); }
  else if (s.type) { const [sel, text] = s.type; const l = page.locator(sel).first(); await l.waitFor({ timeout: 9000 }); await l.scrollIntoViewIfNeeded(); await moveTo(page, l); await l.click(); await page.keyboard.type(text, { delay: 32 }); }
  else if (s.select) { const [sel, label] = s.select; const l = page.locator(sel).first(); await l.waitFor({ timeout: 9000 }); await moveTo(page, l); await sleep(300); await l.selectOption({ label }); }
  else if (s.scroll) { await page.mouse.move(VIEW.width / 2 + 120, VIEW.height / 2, { steps: 8 }); const n = 14; for (let i = 0; i < n; i++) { await page.mouse.wheel(0, s.scroll / n); await sleep(45); } }
}

async function record(sc) {
  const dur = durs[sc.id] + 0.8; const { role, steps } = sc.visual;
  const dir = path.join(OUT, sc.id); fs.rmSync(dir, { recursive: true, force: true });
  const t0 = Date.now();
  const ctx = await browser.newContext({ viewport: VIEW, recordVideo: { dir, size: VIEW } });
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage(); if (process.env.DBG) page.on('response', (r) => { if (r.status() >= 400) console.log('   HTTP', r.status(), r.url().slice(0, 110)); }); page.on('dialog', (d) => d.accept('')); page.setDefaultTimeout(6000);
  await login(page, role);
  const first = steps[0]; if (first.goto) { await page.goto(WEB + first.goto); await page.waitForTimeout(900); }
  const start = Date.now(); const sumW = steps.reduce((a, s) => a + (s.w ?? 1), 0); let acc = 0;
  for (const [i, s] of steps.entries()) {
    acc += s.w ?? 1; const target = start + (acc / sumW) * dur * 1000;
    if (!(i === 0 && s.goto)) { try { await act(page, s); } catch (e) { console.warn(`  ⚠ ${sc.id} étape ${i} ignorée : ${String(e.message).split('\n')[0]}`); } }
    const rest = target - Date.now(); if (rest > 0) await sleep(rest);
  }
  const video = page.video(); await ctx.close(); const file = await video.path();
  fs.writeFileSync(path.join(OUT, sc.id + '.json'), JSON.stringify({ file, offset: Math.max(0, (start - t0) / 1000 - 0.15), dur }));
  console.log('✓', sc.id, Math.round(dur) + ' s');
}

const live = scenes.filter((s) => s.visual.type === 'live' && (!only.size || only.has(s.id)));
const chain = live.filter((s) => s.id.startsWith('exp-') || s.id === 'modules'); // ordre imposé : les scènes qui modifient la démo
const free = live.filter((s) => !chain.includes(s));
const pool = async (list, n) => { const q = [...list]; await Promise.all(Array.from({ length: n }, async () => { while (q.length) await record(q.shift()); })); };
await pool(live.filter((s) => !chain.includes(s)), 1); for (const s of chain) await record(s);
await browser.close();
