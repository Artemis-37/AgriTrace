// Enregistre les scènes « live » du film : le vrai portail piloté (curseur visible, saisie, clics), au rythme de la narration.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/home/claude/agritrace-github/web/package.json');
const { chromium } = require('playwright-core');
const WEB = 'http://127.0.0.1:4173';
const OUT = '/tmp/promo2/live'; fs.mkdirSync(OUT, { recursive: true });
const scenes = JSON.parse(fs.readFileSync('/tmp/promo2/timeline.json', 'utf8')).filter((s) => s.kind === 'live');
const demo = JSON.parse(fs.readFileSync('/tmp/demo-accounts.json', 'utf8'));
const only = new Set(process.argv.slice(2));
const VIEW = { width: 1120, height: 668 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const CURSOR = () => {
  const make = () => {
    if (document.getElementById('__cur') || !document.body) return;
    const c = document.createElement('div'); c.id = '__cur';
    c.style.cssText = 'position:fixed;z-index:2147483647;width:24px;height:24px;border-radius:50%;background:rgba(212,162,76,.55);border:3px solid #fff;pointer-events:none;left:-60px;top:-60px;transition:transform .08s;box-shadow:0 0 10px rgba(0,0,0,.5)';
    document.body.appendChild(c);
    window.addEventListener('mousemove', (e) => { c.style.left = e.clientX - 12 + 'px'; c.style.top = e.clientY - 12 + 'px'; }, true);
    window.addEventListener('mousedown', () => { c.style.transform = 'scale(.6)'; }, true);
    window.addEventListener('mouseup', () => { c.style.transform = 'scale(1)'; }, true);
  };
  document.addEventListener('DOMContentLoaded', make); make();
};
async function login(page, role) {
  const a = demo.accounts.find((x) => x.role === role); if (!a) throw new Error('compte introuvable : ' + role);
  await page.goto(WEB + '/'); await page.fill('input[type=email]', a.email); await page.fill('input[type=password]', demo.password); await page.click('button[type=submit]'); await page.waitForTimeout(1800);
  if (await page.locator('button:has-text("DEMO8915")').count()) { await page.locator('button:has-text("DEMO8915")').first().click(); await page.waitForTimeout(1200); }
}
async function moveTo(page, loc) { const box = await loc.boundingBox(); if (!box) return; await page.mouse.move(box.x + Math.min(box.width / 2, 120), box.y + box.height / 2, { steps: 26 }); }
async function act(page, s) {
  if (s.goto) { await page.goto(WEB + s.goto); await page.waitForTimeout(700); }
  else if (s.tab) { const l = page.locator(`[role=tab]:has-text("${s.tab}")`).first(); await l.waitFor({ timeout: 6000 }); await moveTo(page, l); await l.click(); }
  else if (s.click) { const l = page.locator(s.click).first(); await l.waitFor({ timeout: 6000 }); await l.scrollIntoViewIfNeeded(); await moveTo(page, l); await sleep(250); await l.click(); }
  else if (s.hover) { const l = page.locator(s.hover).first(); await l.waitFor({ timeout: 6000 }); await l.scrollIntoViewIfNeeded(); await moveTo(page, l); }
  else if (s.type) { const [sel, text] = s.type; const l = page.locator(sel).first(); await l.waitFor({ timeout: 6000 }); await l.scrollIntoViewIfNeeded(); await moveTo(page, l); await l.click(); await page.keyboard.type(text, { delay: 55 }); }
  else if (s.select) { const [sel, label] = s.select; const l = page.locator(sel).first(); await l.waitFor({ timeout: 6000 }); await moveTo(page, l); await sleep(300); await l.selectOption({ label }); }
  else if (s.idx) { const [sel, i] = s.idx; const l = page.locator(sel).first(); await l.waitFor({ timeout: 6000 }); await moveTo(page, l); await sleep(300); await l.selectOption({ index: i }); }
  else if (s.scroll) { await page.mouse.move(VIEW.width / 2 + 100, VIEW.height / 2, { steps: 8 }); const n = 14; for (let i = 0; i < n; i++) { await page.mouse.wheel(0, s.scroll / n); await sleep(45); } }
}
async function record(sc) {
  const dur = sc.dur - 1.0; const { role, steps } = sc.live;
  const dir = `${OUT}/${sc.id}`; fs.rmSync(dir, { recursive: true, force: true });
  const t0 = Date.now();
  const ctx = await browser.newContext({ viewport: VIEW, recordVideo: { dir, size: VIEW } });
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage(); page.on('dialog', (d) => d.accept('')); page.setDefaultTimeout(6000);
  await login(page, role);
  const first = steps[0]; if (first.goto) { await page.goto(WEB + first.goto); await page.waitForTimeout(900); }
  const start = Date.now(); const sumW = steps.reduce((a, s) => a + (s.w ?? (s.wait ? 1 : 0.4)), 0); let acc = 0;
  for (const [i, s] of steps.entries()) {
    acc += s.w ?? (s.wait ? 1 : 0.4); const target = start + (acc / sumW) * dur * 1000;
    if (!(i === 0 && s.goto) && !s.wait) { try { await act(page, s); } catch (e) { console.warn(`  ⚠ ${sc.id} étape ${i} (${JSON.stringify(s).slice(0, 60)}) ignorée : ${String(e.message).split('\n')[0]}`); } }
    const rest = target - Date.now(); if (rest > 0) await sleep(rest);
  }
  const video = page.video(); await ctx.close(); const file = await video.path();
  fs.writeFileSync(`${OUT}/${sc.id}.json`, JSON.stringify({ file, offset: Math.max(0, (start - t0) / 1000 - 0.1), dur }));
  console.log('✓', sc.id, Math.round(dur) + ' s');
}
for (const sc of scenes) if (!only.size || only.has(sc.id)) await record(sc);
await browser.close();
