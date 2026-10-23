// Navigateur : le collecteur déclare un convoi, l'administrateur (magasinier + caisse) le réceptionne puis crédite le collecteur.
//   API=... WEB=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node e2e/parcours-convois.mjs
import { chromium } from 'playwright-core';
import { WEB, PW, must, seedBase, call } from './lib.mjs';

const { email, colEmail, J, wh } = await seedBase();
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
const problems = [];
page.on('pageerror', (e) => problems.push('erreur JavaScript : ' + e.message));
let ok = 0;
const step = async (name, fn) => { try { await fn(); ok++; console.log('  ✓', name); } catch (e) { console.log('  ✗', name, '—', e.message.split('\n')[0]); await page.screenshot({ path: 'e2e-echec.png' }).catch(() => undefined); await browser.close(); process.exit(1); } };
// Navigation interne (le jeton de session n'est pas conservé à un rechargement) : on passe par l'historique du routeur.
const go = async (path) => { await page.evaluate((p) => { history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path); await page.waitForTimeout(1000); };
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
await step('le délégué (mobile uniquement) déclare un convoi par l\'application ; le portail web lui est refusé', async () => {
  const tcol = (await call('POST', '/auth/login', { body: { email: colEmail, password: PW } })).access_token;
  const r = await call('POST', '/convoys', { token: tcol, org: J.org, body: { idempotency_key: 'cv-ui-' + Date.now(), convoy_no: 'CV-UI-001', driver_name: 'Traoré Moussa', truck_no: 'AB 1234 CI' } });
  must(r.id || r.convoy_no, 'convoi non créé', r);
  await page.goto(WEB + '/');
  await page.fill('input[type=email]', colEmail); await page.fill('input[type=password]', PW); await page.click('button[type=submit]');
  await page.waitForTimeout(2000);
  must((await page.innerText('body')).includes('uniquement depuis l'), 'le portail web devrait refuser le compte mobile');
});
let recv;
await step('le magasinier réceptionne (pesée) puis la caisse règle : montant calculé, compte du délégué crédité', async () => {
  const cols = await call('GET', '/convoys/collectors', J);
  const collector = (cols.find?.((c) => c.email === colEmail || c.full_name === 'col') ?? cols[0]);
  must(collector?.id, 'délégué introuvable', cols);
  recv = await call('POST', '/convoys/receive', { ...J, body: { idempotency_key: 'rv-ui-' + Date.now(), collector_id: collector.id, convoy_no: 'CV-UI-001', warehouse_id: wh.id, gross_kg: '2587.5', bags: 40, bags_unloaded: 0 } });
  const rid = recv.reception?.id ?? recv.id;
  must(rid, 'réception non créée', recv);
  const st = await call('POST', `/convoy-receptions/${rid}/settle`, { ...J, body: { idempotency_key: 'st-ui-' + Date.now(), unit_price: '1000' } });
  must(String(st.amount ?? st.reception?.amount ?? '').replace(/\.0+$/, '').startsWith('2587500') || JSON.stringify(st).includes('2587500'), 'montant 2 587 500 absent', st);
  await login(email);
  await go('/convois');
  must((await page.locator('tbody').innerText()).includes('CV-UI-001'), 'convoi absent de la liste');
  must(/Réglé/.test(await page.locator('tbody').innerText()), 'état Réglé absent');
});
await step('cloche : l\'administrateur voit les alertes de gestion', async () => {
  await login(email);
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Notifications/ }).first().click(); await page.waitForTimeout(800);
  const panel = await page.locator('.bell-panel').innerText();
  must(panel.includes('Réception à traiter en caisse') || panel.includes('Convoi en route'), 'alertes de gestion absentes : ' + panel.slice(0, 300));
  must(!panel.includes('Réception à traiter en caisse'), 'alerte de caisse non soldée après traitement');
  await page.locator('.bell-panel li button').first().click(); await page.waitForTimeout(1200);
  must(page.url().includes('/pesees'), 'adresse inattendue : ' + page.url());
});
await step('le magasinier ne voit ni conformité, ni cartographie, ni caisse/comptabilité, ni équipe, ni missions', async () => {
  const r = await call('POST', '/roles/standard', { ...J, body: { code: 'magasinier' } });
  await call('POST', '/users', { ...J, body: { email: 'mag.' + colEmail, full_name: 'Magasinier', password: PW, role_id: r.id } });
  await login('mag.' + colEmail);
  const nav = await page.locator('nav[aria-label="Menus"]').evaluate((e) => e.textContent);
  for (const t of ['Convois', 'Stocks et lots']) must(nav.includes(t), `menu ${t} absent pour le magasinier : ${nav.replace(/\s+/g, ' ')}`);
  for (const t of ['Cartographie', 'Qualité et conformité', 'Finances', 'Équipe', 'Missions', 'Préfinancement', 'Parcelles', 'Commerce', 'Synchronisation']) must(!nav.includes(t), `le magasinier voit « ${t} »`);
  await go('/convois');
  must(!(await page.getByRole('tab', { name: 'Caisse' }).count()) && !(await page.getByRole('tab', { name: 'Comptes collecteurs' }).count()), 'le magasinier voit la caisse');
  await go('/pesees');
  must((await page.innerText('main')).includes('Pesée') || (await page.innerText('main')).includes('pesée'), 'page Pesées absente pour le magasinier');
  await go('/finances');
  must(!(await page.innerText('main')).includes('Comptes financiers'), 'page Finances accessible par URL');
});
await browser.close();
if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
console.log(`\n${ok} étapes réussies`);
