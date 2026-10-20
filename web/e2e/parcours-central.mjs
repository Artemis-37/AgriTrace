// Navigateur : console du serveur central (administrateur de plateforme) — ajout d'une coopérative, code de jumelage, vue consolidée.
//   API=... WEB=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node e2e/parcours-central.mjs
import { chromium } from 'playwright-core';
import { WEB, run, must } from './lib.mjs';

const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
const problems = [];
page.on('pageerror', (e) => problems.push('erreur JavaScript : ' + e.message));
page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/v1/')) problems.push(`HTTP ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
let ok = 0;
const step = async (name, fn) => { try { await fn(); ok++; console.log('  ✓', name); } catch (e) { console.log('  ✗', name, '—', e.message.split('\n')[0]); await page.screenshot({ path: 'e2e-echec.png' }).catch(() => undefined); await browser.close(); process.exit(1); } };

console.log('Console du serveur central dans le navigateur');
await step('l\'administrateur de plateforme arrive sur la console centrale', async () => {
  await page.goto(WEB + '/');
  await page.fill('input[type=email]', process.env.ADMIN_EMAIL); await page.fill('input[type=password]', process.env.ADMIN_PASSWORD); await page.click('button[type=submit]');
  await page.waitForTimeout(1500);
  must(await page.getByRole('heading', { name: 'Serveur central' }).count(), 'console absente');
});
await step('ajouter une coopérative et obtenir le code de jumelage', async () => {
  await page.getByRole('button', { name: 'Ajouter une coopérative' }).click(); await page.waitForTimeout(300);
  const m = page.locator('[role=dialog]');
  await m.getByLabel(/^Code/).fill('CEN' + run); await m.getByLabel(/^Nom de la coopérative/).fill('Coopérative ' + run);
  await m.getByRole('button', { name: 'Créer et obtenir le code' }).click(); await page.waitForTimeout(1200);
  const code = await page.locator('[role=dialog] textarea').inputValue();
  must(code.startsWith('AGT1-'), 'code de jumelage absent', code.slice(0, 20));
  await page.locator('.modal-actions').getByRole('button', { name: 'Fermer' }).click(); await page.waitForTimeout(500);
});
await step('le site apparaît, « Jamais » reçu', async () => {
  const t = await page.locator('main').innerText();
  must(t.includes('Coopérative ' + run) && t.includes('Jamais'), 'site absent');
});
await step('suspendre puis réactiver le site', async () => {
  const row = () => page.locator('tr', { hasText: 'Coopérative ' + run });
  // Attente active (jusqu'à 6 s) : sur un poste lent, l'état change après la réponse du serveur.
  const until = async (cond, msg) => { for (let i = 0; i < 30; i++) { if (await cond()) return; await page.waitForTimeout(200); } throw new Error(msg); };
  await row().getByRole('button', { name: 'Suspendre' }).click();
  await until(async () => (await row().innerText()).includes('Suspendu'), 'suspension absente');
  await row().getByRole('button', { name: 'Réactiver' }).click();
  await until(async () => !(await row().innerText()).includes('Suspendu'), 'réactivation absente');
});
await step('la vue consolidée liste la coopérative', async () => {
  await page.getByRole('tab', { name: 'Vue consolidée' }).click(); await page.waitForTimeout(1200);
  const t = await page.locator('main').innerText();
  must(t.includes('Coopératives') && t.includes('Coopérative ' + run), 'consolidation incomplète');
});
await step('aucune erreur réseau ni JavaScript', async () => { must(!problems.length, 'problèmes', problems); });
console.log(`\n${ok} étapes réussies`);
await browser.close();
