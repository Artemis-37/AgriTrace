// Navigateur : un poste continue de travailler quand le serveur n'est pas joignable, puis tout est envoyé au retour (achat + message).
//   API=... WEB=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node e2e/parcours-hors-ligne.mjs
import { chromium } from 'playwright-core';
import { WEB, PW, call, must, seedBase } from './lib.mjs';

const { colEmail: email, J, prod } = await seedBase(); // le poste est celui d'un collecteur (seul profil autorisé à déclarer un achat)
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push('erreur JavaScript : ' + e.message));
let ok = 0;
const step = async (name, fn) => { try { await fn(); ok++; console.log('  ✓', name); } catch (e) { console.log('  ✗', name, '—', e.message.split('\n')[0]); await page.screenshot({ path: 'e2e-echec.png' }).catch(() => undefined); await browser.close(); process.exit(1); } };
const nav = async (label) => { await page.getByRole('link', { name: new RegExp(label) }).first().click(); await page.waitForTimeout(900); };
const MSG = 'Le camion est arrivé sans réseau ' + Date.now();

console.log('Fonctionnement hors connexion dans le navigateur');
await step('connexion', async () => {
  await page.goto(WEB + '/');
  await page.fill('input[type=email]', email); await page.fill('input[type=password]', PW); await page.click('button[type=submit]');
  await page.waitForTimeout(1500);
  if (await page.locator('.org-list button').count()) { await page.locator('.org-list button').first().click(); await page.waitForTimeout(1200); }
  must(await page.getByText('Bonjour').count(), 'tableau de bord absent');
});
await step('en ligne : les écrans utiles sont chargés une fois (mise en mémoire du poste)', async () => {
  await nav('Mes achats'); await page.getByRole('button', { name: 'Déclarer un achat' }).click(); await page.waitForTimeout(1200);
  must((await page.locator('[role=dialog]').innerText()).includes('Producteur'), 'formulaire absent');
  await page.locator('[role=dialog]').getByRole('button', { name: 'Annuler' }).click();
  await nav('Messages'); await page.waitForTimeout(500);
});
await step('le serveur devient injoignable : bandeau « Hors connexion »', async () => {
  await ctx.setOffline(true);
  await page.getByRole('link', { name: /Mes achats/ }).first().click(); await page.waitForTimeout(1500);
  must((await page.locator('.offline-bar').innerText()).includes('Hors connexion'), 'bandeau absent');
});
await step('hors connexion : la liste des déclarations reste lisible (copie du poste)', async () => {
  must(!(await page.locator('main').innerText()).includes('Hors connexion : ces données'), 'copie absente');
  must(await page.getByRole('button', { name: 'Déclarer un achat' }).count(), 'bouton absent');
});
await step('hors connexion : saisie d\'un achat enregistrée sur le poste', async () => {
  await page.getByRole('button', { name: 'Déclarer un achat' }).click(); await page.waitForTimeout(1200);
  const m = page.locator('[role=dialog]');
  const search = m.getByLabel('Rechercher un producteur');
  await search.fill('zzzz'); await page.waitForTimeout(200);
  must((await m.innerText()).includes('Aucun producteur ne correspond'), 'recherche sans résultat non signalée');
  await search.fill('awa kone'); await page.waitForTimeout(300);   // nom, dans l'ordre inverse, sans casse
  must((await m.innerText()).includes('KONE Awa'), 'recherche par nom absente');
  await search.fill('kone'); await page.waitForTimeout(200);
  await m.getByRole('option').first().getByRole('button').click(); await page.waitForTimeout(300);
  must(await m.getByLabel('Poids (kg)').count(), 'saisie du poids absente après sélection du producteur');
  must(await m.getByRole('button', { name: 'Enregistrer sur ce poste' }).isDisabled(), 'enregistrement possible sans poids, sacs ni reçu');
  await m.getByLabel('Poids (kg)').fill('420'); await m.getByLabel('Nombre de sacs').fill('7'); await m.getByLabel('N° du reçu').fill('RC-0420');
  await m.getByRole('button', { name: 'Enregistrer sur ce poste' }).click(); await page.waitForTimeout(1200);
  must((await page.locator('.offline-bar').innerText()).includes('2 en attente'), 'file non mise à jour');
});
await step('hors connexion : message écrit, affiché « en attente d\'envoi »', async () => {
  await nav('Messages');
  await page.getByLabel('Votre message').fill(MSG); await page.getByRole('button', { name: 'Envoyer' }).click(); await page.waitForTimeout(900);
  must((await page.locator('.chat-thread').innerText()).includes("En attente d'envoi"), 'message non mis en attente');
});
await step('le serveur ne contient encore rien', async () => {
  const d = await call('GET', '/purchase-declarations', J);
  must(!d.some((x) => Number(x.quantity) === 420), 'achat déjà au serveur');
});
await step('retour du serveur : envoi automatique, bandeau disparu', async () => {
  await ctx.setOffline(false);
  for (let i = 0; i < 30; i++) { await page.waitForTimeout(1000); if (!(await page.locator('.offline-bar').count())) break; }
  if (await page.locator('.offline-bar').count()) { await page.getByRole('button', { name: 'Détails' }).click(); await page.waitForTimeout(300); must(false, 'bandeau toujours là', await page.locator('[role=dialog]').innerText()); }
});
await step('l\'achat est au serveur, soumis', async () => {
  const d = await call('GET', '/purchase-declarations', J);
  const mine = d.find((x) => Number(x.quantity) === 420);
  must(mine && mine.producer_id === prod.id && ['submitted', 'received'].includes(mine.status), 'achat absent ou mauvais statut', mine);
});
await step('le message est au serveur (une seule fois) et affiché normalement', async () => {
  await page.waitForTimeout(9000);
  const rows = await call('GET', '/messages?with=general', J);
  must(rows.filter((m) => m.body === MSG).length === 1, 'message absent ou en double', rows.length);
  must(!(await page.locator('.chat-thread').innerText()).includes("En attente d'envoi"), 'toujours en attente');
});
await step('thème nuit puis retour au thème doux', async () => {
  await page.getByRole('button', { name: /thème d'affichage/ }).click(); await page.waitForTimeout(300);
  must((await page.evaluate(() => document.documentElement.dataset.theme)) === 'night', 'thème nuit non appliqué');
  await page.screenshot({ path: 'e2e-theme-nuit.png' });
  await page.getByRole('button', { name: /thème d'affichage/ }).click();
  must((await page.evaluate(() => document.documentElement.dataset.theme)) === 'doux', 'thème doux non rétabli');
  await page.screenshot({ path: 'e2e-theme-doux.png' });
});
await step('aucune erreur JavaScript', async () => { must(!problems.length, 'problèmes', problems); });
console.log(`\n${ok} étapes réussies`);
await browser.close();
