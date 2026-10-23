// Navigateur : le collecteur déclare un convoi, l'administrateur (magasinier + caisse) le réceptionne puis crédite le collecteur.
//   API=... WEB=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node e2e/parcours-convois.mjs
import { chromium } from 'playwright-core';
import { WEB, PW, must, seedBase, call } from './lib.mjs';

const { email, colEmail, J } = await seedBase();
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
await step('cloche : le collecteur voit les alertes qui le concernent, le panneau marque comme lu', async () => {
  await login(colEmail);
  await page.waitForTimeout(800);
  const bell = page.getByRole('button', { name: /Notifications/ }).first();
  const label = await bell.getAttribute('aria-label');
  must(/non lue/.test(label ?? ''), 'compteur de la cloche absent : ' + label);
  await bell.click(); await page.waitForTimeout(800);
  const panel = (await page.locator('.bell-panel').innerText());
  must(panel.includes('Votre convoi CV-UI-001 a été reçu') && panel.includes('Net à payer porté à votre compte'), 'alertes du collecteur absentes : ' + panel.slice(0, 300));
  must(!panel.includes('Réception à traiter en caisse') && !panel.includes('Convoi en route'), 'alerte de gestion visible pour le collecteur');
  await page.getByRole('button', { name: /Net à payer porté à votre compte/ }).click(); await page.waitForTimeout(1000);
  must(page.url().includes('/convois'), 'le clic ne mène pas à la page de traitement : ' + page.url());
  await page.getByRole('button', { name: /Notifications/ }).first().click(); await page.waitForTimeout(800);
  must(!(await page.locator('.bell-panel').innerText()).includes('Net à payer porté à votre compte'), 'alerte ouverte toujours dans le fil');
  await page.getByRole('button', { name: 'Tout marquer comme lu' }).click(); await page.waitForTimeout(800);
  must(!/non lue/.test((await page.getByRole('button', { name: /Notifications/ }).first().getAttribute('aria-label')) ?? ''), 'compteur non remis à zéro');
  await page.keyboard.press('Escape');
});
await step('cloche : l\'administrateur voit les alertes de gestion', async () => {
  await login(email);
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Notifications/ }).first().click(); await page.waitForTimeout(800);
  const panel = await page.locator('.bell-panel').innerText();
  must(panel.includes('Réception à traiter en caisse') || panel.includes('Convoi en route'), 'alertes de gestion absentes : ' + panel.slice(0, 300));
  must(!panel.includes('Réception à traiter en caisse'), 'alerte de caisse non soldée après traitement');
  await page.locator('.bell-panel li button').first().click(); await page.waitForTimeout(1200);
  must(page.url().includes('/convois?tab=receive'), 'adresse inattendue : ' + page.url());
  must(await page.getByRole('tab', { name: 'Réception au magasin', selected: true }).count() === 1, 'onglet « Réception au magasin » non ouvert');
});
await step('espace du collecteur : Mes achats, Mon stock, Historique, sans menus de gestion', async () => {
  await login(colEmail);
  const nav = await page.locator('nav[aria-label="Menus"]').evaluate((e) => e.textContent);
  for (const t of ['Mes achats', 'Mon stock', 'Historique']) must(nav.includes(t), `menu ${t} absent`);
  must(!nav.includes('Finances') && !nav.includes('Équipe') && !nav.includes('Déclarations d\'achat'), 'menu de gestion visible pour le collecteur');
  must((await page.innerText('main')).includes('application mobile'), 'bandeau mobile absent');
  await page.goto(page.url().split('/').slice(0, 3).join('/') + '/mon-stock'); await page.waitForTimeout(1200);
  const t = (await page.innerText('main')).replace(/\s/g, ' ');
  must(/2\s?588\s?kg|2\s?587\s?kg/.test(t) && t.includes('Livré au magasin'), 'stock livré absent : ' + t.slice(0, 300));
  must(/334\s?150/.test(t), 'solde de la fiche absent : ' + t.slice(0, 400));
  await page.getByRole('link', { name: /Historique/ }).click(); await page.waitForTimeout(1000);
  must((await page.innerText('main')).includes('Historique de mes achats'), 'page Historique absente');
  await page.getByRole('link', { name: /Mes achats/ }).click(); await page.waitForTimeout(800);
  must(await page.getByRole('button', { name: 'Achat', exact: true }).count(), 'bouton Achat absent');
});
await step('le magasinier ne voit ni conformité, ni cartographie, ni caisse/comptabilité, ni équipe, ni missions', async () => {
  const r = await call('POST', '/roles/standard', { ...J, body: { code: 'magasinier' } });
  await call('POST', '/users', { ...J, body: { email: 'mag.' + colEmail, full_name: 'Magasinier', password: PW, role_id: r.id } });
  await login('mag.' + colEmail);
  const nav = await page.locator('nav').first().innerText();
  for (const t of ['Convois', 'Stocks et lots']) must(nav.includes(t), `menu ${t} absent pour le magasinier : ${nav.replace(/\s+/g, ' ')}`);
  for (const t of ['Cartographie', 'Qualité et conformité', 'Finances', 'Équipe', 'Missions', 'Préfinancement', 'Parcelles', 'Commerce', 'Synchronisation']) must(!nav.includes(t), `le magasinier voit « ${t} »`);
  await page.getByRole('link', { name: /Convois/ }).click(); await page.waitForTimeout(900);
  must(!(await page.getByRole('tab', { name: 'Caisse' }).count()) && !(await page.getByRole('tab', { name: 'Comptes collecteurs' }).count()), 'le magasinier voit la caisse');
  must(await page.getByRole('tab', { name: 'Réception au magasin' }).count(), 'onglet Réception absent');
  await page.goto(WEB + '/finances'); await page.waitForTimeout(800);
  must(!(await page.innerText('main')).includes('Comptes financiers'), 'page Finances accessible par URL');
});
await browser.close();
if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
console.log(`\n${ok} étapes réussies`);
