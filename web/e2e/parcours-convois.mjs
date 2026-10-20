// Navigateur : le collecteur déclare un convoi, l'administrateur (magasinier + caisse) le réceptionne puis crédite le collecteur.
//   API=... WEB=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node e2e/parcours-convois.mjs
import { chromium } from 'playwright-core';
import { WEB, PW, must, seedBase } from './lib.mjs';

const { email, colEmail } = await seedBase();
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
const problems = [];
page.on('pageerror', (e) => problems.push('erreur JavaScript : ' + e.message));
let ok = 0;
const step = async (name, fn) => { try { await fn(); ok++; console.log('  ✓', name); } catch (e) { console.log('  ✗', name, '—', e.message.split('\n')[0]); await page.screenshot({ path: 'e2e-echec.png' }).catch(() => undefined); await browser.close(); process.exit(1); } };
const modal = () => page.locator('[role=dialog], .modal').first();
const login = async (mail) => {
  await page.context().close();
  page = await (await browser.newContext({ viewport: { width: 1300, height: 1000 } })).newPage();
  page.on('pageerror', (e) => problems.push('erreur JavaScript : ' + e.message));
  await page.goto(WEB + '/');
  await page.fill('input[type=email]', mail); await page.fill('input[type=password]', PW); await page.click('button[type=submit]');
  await page.waitForTimeout(1500);
  if (await page.locator('.org-list button').count()) { await page.locator('.org-list button').first().click(); await page.waitForTimeout(1200); }
};

console.log('Convois, réception et caisse dans le navigateur');
await step('le collecteur voit le menu Convois et déclare un convoi', async () => {
  await login(colEmail);
  await page.getByRole('link', { name: /Convois/ }).click(); await page.waitForTimeout(800);
  must(!(await page.getByRole('tab', { name: 'Caisse' }).count()), 'le collecteur voit l\'onglet Caisse');
  await page.getByRole('button', { name: 'Déclarer un convoi' }).click(); await page.waitForTimeout(400);
  const m = modal();
  must(await m.getByRole('button', { name: 'Enregistrer' }).isDisabled(), 'enregistrement possible sans n° de convoi');
  await m.getByLabel(/connaissement du convoi/).fill('CV-UI-001');
  await m.getByLabel('Nom du chauffeur').fill('Traoré Moussa');
  await m.getByLabel('N° du camion').fill('AB 1234 CI');
  await m.getByRole('button', { name: 'Enregistrer' }).click(); await page.waitForTimeout(2500);
  const t = await page.locator('tbody').innerText();
  must(t.includes('CV-UI-001') && t.includes('En route'), 'convoi absent de la liste: ' + t.slice(0, 200));
});
await step('l\'administrateur réceptionne : collecteur, n° de convoi, poids, sacs', async () => {
  await login(email);
  await page.getByRole('link', { name: /Convois/ }).click(); await page.waitForTimeout(800);
  await page.getByRole('tab', { name: 'Réception au magasin' }).click(); await page.waitForTimeout(800);
  await page.locator('select').nth(0).selectOption({ index: 1 });
  await page.locator('input[list]').fill('CV-UI-001'); await page.waitForTimeout(300);
  must((await page.innerText('main')).includes('Traoré Moussa'), 'chauffeur attendu non affiché');
  await page.locator('select').nth(1).selectOption({ index: 1 });
  await page.getByLabel(/Poids total/).fill('2587.5'); await page.getByLabel('Nombre de sacs').fill('40');
  await page.getByRole('button', { name: /Valider la réception/ }).click(); await page.waitForTimeout(2500);
  must((await page.innerText('main')).includes('transmis à la caisse'), 'confirmation absente');
});
await step('la caisse traite : montant calculé, compte du collecteur crédité', async () => {
  await page.getByRole('tab', { name: 'Caisse' }).click(); await page.waitForTimeout(800);
  await page.locator('tbody').waitFor({ timeout: 8000 });
  must((await page.locator('tbody').innerText()).includes('CV-UI-001'), 'réception absente de la file');
  await page.getByRole('button', { name: 'Traiter' }).click(); await page.waitForTimeout(400);
  const m = modal();
  await m.getByLabel(/P\.U\./).fill('1000');
  must((await m.innerText()).replace(/\s/g, ' ').match(/2\s?587\s?500/), 'montant 2 587 500 absent: ' + (await m.innerText()));
  await m.getByRole('button', { name: 'Enregistrer le net à payer' }).click(); await page.waitForTimeout(2000);
  must((await page.innerText('main')).includes('Aucune réception en attente'), 'réception toujours dans la file');
  await page.getByRole('link', { name: /Convois/ }).click(); await page.waitForTimeout(500);
  await page.getByRole('tab', { name: 'Convois' }).click(); await page.waitForTimeout(800);
  must((await page.locator('tbody').innerText()).includes('Réglé'), 'état Réglé absent');
});
await step('fiche de suivi : report de solde puis ligne de livraison avec solde', async () => {
  await login(email);
  await page.getByRole('link', { name: /Convois/ }).click(); await page.waitForTimeout(800);
  await page.getByRole('tab', { name: 'Comptes collecteurs' }).click(); await page.waitForTimeout(800);
  await page.getByLabel('Collecteur').selectOption({ index: 1 }); await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Reporter un solde de campagne' }).click(); await page.waitForTimeout(300);
  const m = modal();
  await m.getByLabel(/Montant/).fill('2253350'); await m.getByLabel(/pièce/).fill('REP-24');
  await m.getByRole('button', { name: 'Enregistrer' }).click(); await page.waitForTimeout(1500);
  const t = (await page.innerText('main')).replace(/\s/g, ' ');
  must(/2\s?253\s?350/.test(t), 'report absent de la fiche : ' + t.slice(0, 300));
  must(/CV-UI-001/.test(t), 'ligne de livraison absente');
  must(/334\s?150|2\s?587\s?500/.test(t), 'net ou solde absent');
});
await step('espace du collecteur : Mes achats, Mon stock, Historique, sans menus de gestion', async () => {
  await login(colEmail);
  const nav = await page.locator('aside').innerText();
  for (const t of ['Mes achats', 'Mon stock', 'Historique']) must(nav.includes(t), `menu ${t} absent`);
  must(!nav.includes('Finances') && !nav.includes('Équipe') && !nav.includes('Déclarations d\'achat'), 'menu de gestion visible pour le collecteur');
  must((await page.innerText('main')).includes('application mobile'), 'bandeau mobile absent');
  await page.getByRole('link', { name: /Mon stock/ }).click(); await page.waitForTimeout(1200);
  const t = (await page.innerText('main')).replace(/\s/g, ' ');
  must(/2\s?588\s?kg|2\s?587\s?kg/.test(t) && t.includes('Livré au magasin'), 'stock livré absent : ' + t.slice(0, 300));
  must(/334\s?150/.test(t), 'solde de la fiche absent : ' + t.slice(0, 400));
  await page.getByRole('link', { name: /Historique/ }).click(); await page.waitForTimeout(1000);
  must((await page.innerText('main')).includes('Historique de mes achats'), 'page Historique absente');
  await page.getByRole('link', { name: /Mes achats/ }).click(); await page.waitForTimeout(800);
  must(await page.getByRole('button', { name: 'Déclarer un achat' }).count(), 'bouton Déclarer un achat absent');
});
await browser.close();
if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
console.log(`\n${ok} étapes réussies`);
