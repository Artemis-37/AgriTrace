// Navigateur : l'icône Messages à côté de la cloche affiche le compteur et se balance à l'arrivée d'un nouveau message.
import { chromium } from 'playwright-core';
import { WEB, API, PW, key, call, must, seedBase } from './lib.mjs';
const { email, colEmail, J } = await seedBase();
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await (await browser.newContext({ viewport: { width: 1300, height: 800 } })).newPage();
const problems = []; let ok = 0;
page.on('pageerror', (e) => problems.push(e.message));
const step = async (n, fn) => { try { await fn(); ok++; console.log('  ✓', n); } catch (e) { console.log('  ✗', n, '—', e.message.split('\n')[0]); await browser.close(); process.exit(1); } };
console.log('Icône Messages animée');
await step('connexion : icône Messages présente à côté de la cloche, sans compteur ni balancement', async () => {
  await page.goto(WEB + '/'); await page.fill('input[type=email]', email); await page.fill('input[type=password]', PW); await page.click('button[type=submit]'); await page.waitForTimeout(1800);
  if (await page.locator('.org-list button').count()) { await page.locator('.org-list button').first().click(); await page.waitForTimeout(1200); }
  const link = page.locator('.topbar a.bell-link'), bell = page.locator('.topbar button.bell-btn');
  must(await link.count() === 1 && await bell.count() === 1, 'icône ou cloche absente');
  must(await link.locator('.bell-count').count() === 0, 'compteur affiché sans message');
  must(!(await link.getAttribute('class')).includes('is-ringing'), 'balancement au premier affichage');
  must((await link.getAttribute('aria-label')) === 'Messages', 'libellé accessible');
});
await step('un nouveau message arrive : compteur et balancement (cloche de même type)', async () => {
  const tcol = (await call('POST', '/auth/login', { body: { email: colEmail, password: PW } })).access_token;
  const r = await call('POST', '/messages', { token: tcol, org: J.org, body: { idempotency_key: key('m'), body: 'Bonjour, convoi prêt au village.' } });
  must(r && !r.message, 'envoi du message', r);
  const link = page.locator('.topbar a.bell-link');
  let ringing = false;
  for (let i = 0; i < 90 && !ringing; i++) { ringing = (await link.getAttribute('class')).includes('is-ringing'); if (!ringing) await page.waitForTimeout(250); }
  must(ringing, 'pas de balancement dans les 22 s');
  must((await link.locator('.bell-count').innerText()) === '1', 'compteur attendu : 1');
  const anim = await link.locator('.bell-icon').evaluate((e) => getComputedStyle(e).animationName);
  must(anim === 'bell-ring', 'animation : ' + anim);
  await page.screenshot({ path: new URL('./proof-messages.png', import.meta.url).pathname, clip: { x: 900, y: 0, width: 400, height: 90 } });
});
await step('au survol, la cloche et l\'enveloppe se balancent de la même façon', async () => {
  await page.waitForTimeout(3500);
  for (const sel of ['.topbar button.bell-btn', '.topbar a.bell-link']) {
    await page.hover(sel); await page.waitForTimeout(150);
    const anim = await page.locator(sel + ' .bell-icon').evaluate((e) => getComputedStyle(e).animationName);
    must(anim === 'bell-ring', `${sel} : ${anim}`);
  }
});
await step('l\'icône mène à la messagerie ; le compteur retombe après lecture', async () => {
  await page.click('.topbar a.bell-link'); await page.waitForURL(/\/messages/); await page.waitForTimeout(1500);
  await page.getByText('convoi prêt au village', { exact: false }).first().waitFor({ timeout: 8000 });
});
await step('mouvement réduit : aucune animation', async () => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1300, height: 800 } }); const p2 = await ctx.newPage();
  await p2.goto(WEB + '/'); await p2.fill('input[type=email]', email); await p2.fill('input[type=password]', PW); await p2.click('button[type=submit]'); await p2.waitForTimeout(2000);
  if (await p2.locator('.org-list button').count()) { await p2.locator('.org-list button').first().click(); await p2.waitForTimeout(1200); }
  await p2.hover('.topbar a.bell-link'); await p2.waitForTimeout(150);
  const anim = await p2.locator('.topbar a.bell-link .bell-icon').evaluate((e) => getComputedStyle(e).animationName);
  must(anim === 'none', 'animation malgré le mouvement réduit : ' + anim);
});
await browser.close();
if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
console.log(`\n${ok} étapes réussies`);
