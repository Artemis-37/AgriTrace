// Navigateur : premier démarrage d'un serveur local vierge (création de la coopérative), puis page Synchronisation.
//   WEB=http://127.0.0.1:3151 node e2e/parcours-premier-demarrage.mjs   (serveur local vierge, port HTTP du poste = port + 1, mode « local »)
import { chromium } from 'playwright-core';
import { WEB, must } from './lib.mjs';

const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
const problems = [];
page.on('pageerror', (e) => problems.push('erreur JavaScript : ' + e.message));
page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/v1/')) problems.push(`HTTP ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
let ok = 0;
const step = async (name, fn) => { try { await fn(); ok++; console.log('  ✓', name); } catch (e) { console.log('  ✗', name, '—', e.message.split('\n')[0]); await page.screenshot({ path: 'e2e-echec.png' }).catch(() => undefined); await browser.close(); process.exit(1); } };

console.log('Premier démarrage d\'un serveur local dans le navigateur');
await step('un serveur vierge propose la création de la coopérative', async () => {
  await page.goto(WEB + '/'); await page.waitForTimeout(1200);
  must(await page.getByRole('heading', { name: 'Premier démarrage' }).count(), 'écran de premier démarrage absent');
});
await step('un mot de passe trop court est refusé par le formulaire', async () => {
  await page.getByLabel('Code de la coopérative').fill('DEMO'); await page.getByLabel('Nom de la coopérative').fill('Coopérative Démo');
  await page.getByLabel("Nom de l'administrateur").fill('Admin Démo'); await page.getByLabel('Adresse e-mail').fill('admin@demo.test');
  await page.getByLabel(/^Mot de passe/).fill('court');
  await page.getByRole('button', { name: 'Créer la coopérative' }).click(); await page.waitForTimeout(500);
  must(await page.getByRole('heading', { name: 'Premier démarrage' }).count(), 'formulaire validé malgré le mot de passe court');
});
await step('création de la coopérative puis connexion automatique', async () => {
  await page.getByLabel(/^Mot de passe/).fill('MotDePasseSolide2026!');
  await page.getByRole('button', { name: 'Créer la coopérative' }).click(); await page.waitForTimeout(2500);
  must(await page.getByText('Bonjour Admin').count(), 'tableau de bord absent');
});
await step('le tableau de bord indique que la synchronisation n\'est pas reliée', async () => {
  const t = await page.locator('main').innerText();
  must(t.includes('Synchronisation avec le central') && t.includes('Non reliée'), 'indicateur absent');
});
await step('la page Synchronisation donne l\'identifiant à communiquer au central', async () => {
  await page.getByRole('link', { name: /Synchronisation/ }).click(); await page.waitForTimeout(900);
  const t = await page.locator('main').innerText();
  must(t.includes('Coopérative Démo') && /[0-9a-f]{8}-[0-9a-f]{4}-/.test(t) && t.includes('Relier au serveur central'), 'page incomplète');
});
await step('un code de jumelage invalide est refusé avec un message clair', async () => {
  await page.getByLabel('Code de jumelage').fill('AGT1-nimportequoi');
  await page.getByRole('button', { name: /Relier et envoyer/ }).click(); await page.waitForTimeout(900);
  must((await page.locator('main').innerText()).includes('illisible'), 'message absent');
  problems.splice(0, problems.length, ...problems.filter((p) => !p.includes('/replication/link')));
});
await step('rechargement : retour sur le tableau de bord sans repasser par le premier démarrage', async () => {
  await page.goto(WEB + '/'); await page.waitForTimeout(1500);
  must(!(await page.getByRole('heading', { name: 'Premier démarrage' }).count()), 'premier démarrage ré-affiché');
});
await step('aucune erreur réseau ni JavaScript', async () => { must(!problems.length, 'problèmes', problems); });
console.log(`\n${ok} étapes réussies`);
await browser.close();
