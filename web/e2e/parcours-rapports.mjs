// Navigateur : rapports d'achats filtrables (période, regroupement) et export Excel, réservés au personnel.
import { chromium } from 'playwright-core';
import { WEB, PW, must, seedBase } from './lib.mjs';
const { email, colEmail } = await seedBase();
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let page = await (await browser.newContext({ viewport: { width: 1300, height: 1000 }, acceptDownloads: true })).newPage();
const problems = []; let ok = 0;
page.on('pageerror', (e) => problems.push('erreur JavaScript : ' + e.message));
const step = async (n, fn) => { try { await fn(); ok++; console.log('  ✓', n); } catch (e) { console.log('  ✗', n, '—', e.message.split('\n')[0]); await browser.close(); process.exit(1); } };
const login = async (mail) => { await page.context().close(); page = await (await browser.newContext({ viewport: { width: 1300, height: 1000 }, acceptDownloads: true })).newPage(); page.on('pageerror', (e) => problems.push(e.message)); await page.goto(WEB + '/'); await page.fill('input[type=email]', mail); await page.fill('input[type=password]', PW); await page.click('button[type=submit]'); await page.waitForTimeout(1500); if (await page.locator('.org-list button').count()) { await page.locator('.org-list button').first().click(); await page.waitForTimeout(1200); } };
console.log('Rapports dans le navigateur');
await step('le personnel ouvre Rapports : totaux et lignes par section', async () => {
  await login(email); await page.getByRole('link', { name: /Rapports/ }).click(); await page.waitForTimeout(1200);
  const t = await page.innerText('main'); must(t.includes('Poids net') && t.includes('Section'), 'rapport absent : ' + t.slice(0, 200));
});
await step('regroupement par collecteur et période sans donnée', async () => {
  await page.getByLabel('Regrouper par').selectOption('collector'); await page.waitForTimeout(800);
  must((await page.innerText('main')).includes('Collecteur'), 'regroupement non appliqué');
  await page.getByLabel('Du', { exact: true }).fill('1999-01-01'); await page.getByLabel('Au', { exact: true }).fill('1999-12-31'); await page.waitForTimeout(1000);
  must((await page.innerText('main')).includes('Aucun achat pour ces critères'), 'période vide non signalée');
});
await step('export Excel téléchargé', async () => {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: 'Exporter vers Excel' }).click()]);
  must(/\.xlsx$/.test(d.suggestedFilename()), 'fichier : ' + d.suggestedFilename());
});
await step('rapports finance, stock et qualité : onglets, indicateurs et export', async () => {
  for (const [tab, marker, file] of [['Finance', 'Créances à encaisser', /financier\.xlsx$/], ['Stock', 'Stock total', /stock\.xlsx$/], ['Qualité', 'Taux de conformité', /qualite\.xlsx$/]]) {
    await page.getByRole('tab', { name: tab }).click(); await page.waitForTimeout(900);
    must((await page.innerText('body')).includes(marker), `onglet ${tab} : « ${marker} » absent`);
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: 'Exporter vers Excel' }).click()]);
    must(file.test(d.suggestedFilename()), 'fichier : ' + d.suggestedFilename());
  }
});
await step('le collecteur ne voit pas Rapports', async () => {
  await login(colEmail); must(!(await page.locator('nav').first().innerText()).includes('Rapports'), 'menu Rapports visible');
});
await browser.close();
if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
console.log(`\n${ok} étapes réussies`);
