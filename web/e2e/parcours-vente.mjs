// Test de bout en bout du navigateur : parcours de vente complet (commande → réservation → expédition → chargement → affectation → départ
// → livraison avec écart → preuve → validation → facture → paiements → réclamation). L'API et le portail doivent tourner.
//   API=http://localhost:3000/v1 WEB=http://localhost:4173 ADMIN_EMAIL=... ADMIN_PASSWORD=... node e2e/parcours-vente.mjs
import crypto from 'node:crypto';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const API = process.env.API ?? 'http://localhost:3000/v1';
const WEB = process.env.WEB ?? 'http://localhost:4173';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
const PW = 'MotDePasseSolide2026!';
const PROOF = path.join(path.dirname(fileURLToPath(import.meta.url)), 'proof.png');
const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;

async function call(method, p, { token, org, body } = {}) {
  const h = {};
  if (token) h.authorization = `Bearer ${token}`;
  if (org) h['x-organization-id'] = org;
  if (body) h['content-type'] = 'application/json';
  const r = await fetch(API + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); try { return JSON.parse(t); } catch { return t; }
}
const must = (cond, msg, extra) => { if (!cond) throw new Error(`${msg}${extra ? ' : ' + JSON.stringify(extra).slice(0, 300) : ''}`); };

async function seed() {
  const adm = (await call('POST', '/auth/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })).access_token;
  must(adm, 'connexion administrateur de plateforme');
  const org = await call('POST', '/organizations', { token: adm, body: { code: 'UI' + run, name: 'UI ' + run } });
  const email = `ui.${run}@t.test`;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email, full_name: 'Admin UI', password: PW } });
  const T = (await call('POST', '/auth/login', { body: { email, password: PW } })).access_token;
  const J = { token: T, org: org.id };
  await call('PUT', '/purchase-declarations/settings/receipts', { ...J, body: { mode: 'physical', series: 'A', required: false } });
  const vc = await call('POST', '/value-chains', { ...J, body: { code: 'CACAO', name: 'Cacao' } });
  await call('POST', '/unit-conversions', { ...J, body: { value_chain_id: vc.id, from_unit: 'sac', to_unit: 'kg', factor: '65' } });
  const camp = await call('POST', '/campaigns', { ...J, body: { value_chain_id: vc.id, code: 'C26', name: 'Campagne', starts_on: '2025-10-01', ends_on: '2027-12-31' } });
  const sched = await call('POST', '/price-schedules', { ...J, body: { value_chain_id: vc.id, campaign_id: camp.id, unit: 'kg' } });
  await call('POST', `/price-schedules/${sched.id}/versions`, { ...J, body: { unit_price: '1000', valid_from: '2025-10-01' } });
  const prod = (await call('POST', '/producers', { ...J, body: { last_name: 'KONE', first_names: 'Awa', village: 'Hiré', value_chain_ids: [vc.id] } })).producer;
  const wh = await call('POST', '/warehouses', { ...J, body: { code: 'MAG1', name: 'Magasin 1' } });
  const rcol = await call('POST', '/roles', { ...J, body: { code: 'collecteur', name: 'Collecteur', permissions: ['declarations:create', 'declarations:read', 'producers:read', 'sync:use'] } });
  const cu = await call('POST', '/users', { ...J, body: { email: `col.${run}@t.test`, full_name: 'col', password: PW, role_id: rcol.id } });
  const col = await call('POST', '/collectors', { ...J, body: { user_id: cu.id } });
  await call('POST', `/collectors/${col.id}/assignments`, { ...J, body: { value_chain_id: vc.id } });
  const tcol = (await call('POST', '/auth/login', { body: { email: `col.${run}@t.test`, password: PW } })).access_token;
  const d = { id: crypto.randomUUID(), idempotency_key: key('d'), producer_id: prod.id, value_chain_id: vc.id, campaign_id: camp.id, operation_date: '2026-02-10', bags: 20, quantity: '20', unit: 'sac' };
  await call('POST', '/sync/batch', { token: tcol, org: org.id, body: { operations: [{ idempotency_key: d.idempotency_key, type: 'purchase_declaration.create', payload: d }, { idempotency_key: key('s'), type: 'purchase_declaration.submit', payload: { id: d.id } }] } });
  await call('POST', `/purchase-declarations/${d.id}/transition`, { ...J, body: { to: 'in_review' } });
  await call('POST', `/purchase-declarations/${d.id}/transition`, { ...J, body: { to: 'accepted' } });
  const w = await call('POST', '/weighings', { ...J, body: { idempotency_key: key('w'), declaration_id: d.id, warehouse_id: wh.id, gross_kg: '1305', tare_kg: '5' } });
  const rc = await call('POST', '/receipts', { ...J, body: { weighing_id: w.id } });
  must(rc.receipt?.lot_id ?? rc.lot_id, 'mise en stock', rc);
  await call('POST', '/vehicles', { ...J, body: { plate: '1234AB01', kind: 'Camion', capacity_kg: '5000' } });
  await call('POST', '/drivers', { ...J, body: { full_name: 'Moussa Diallo' } });
  const by = await call('POST', '/buyers', { ...J, body: { code: 'ACH1', name: 'Acheteur Un', payment_terms_days: 30 } });
  const order = await call('POST', '/sales-orders', { ...J, body: { idempotency_key: key('o'), buyer_id: by.id, value_chain_id: vc.id, lines: [{ quantity_kg: '1000', unit_price: '1000' }] } });
  must(order.id, 'commande', order);
  return { email };
}

const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
const problems = [];
page.on('pageerror', (e) => problems.push('erreur JavaScript : ' + e.message));
let expectedRefusals = 0;
page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/v1/')) problems.push(`HTTP ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
let ok = 0;
const step = async (name, fn) => { try { await fn(); ok++; console.log('  ✓', name); } catch (e) { console.log('  ✗', name, '—', e.message.split('\n')[0]); await page.screenshot({ path: 'e2e-echec.png' }).catch(() => undefined); await browser.close(); process.exit(1); } };
const modal = () => page.locator('[role=dialog], .modal').first();
const go = async (p, tab) => { await page.goto(WEB + p); await page.waitForTimeout(700); if (tab) { await page.getByText(tab, { exact: true }).first().click(); await page.waitForTimeout(600); } };
const text = async () => modal().innerText();

const { email } = await seed();
console.log('Parcours de vente dans le navigateur');
await step('connexion', async () => {
  await page.goto(WEB + '/');
  await page.fill('input[type=email]', email); await page.fill('input[type=password]', PW); await page.click('button[type=submit]');
  await page.waitForTimeout(1500);
  if (await page.locator('.org-list button').count()) { await page.locator('.org-list button').first().click(); await page.waitForTimeout(1200); }
  must(await page.getByText('Commerce').count(), 'menu Commerce absent');
});
await step('confirmer la commande', async () => {
  await go('/commerce'); await page.locator('button.link').first().click(); await page.waitForTimeout(500);
  await modal().getByRole('button', { name: 'Confirmer', exact: true }).click(); await page.waitForTimeout(900);
  must((await text()).includes('Confirmée'), 'statut Confirmée absent');
  await page.keyboard.press('Escape');
});
await step('réserver 1000 kg de stock', async () => {
  await go('/commerce'); await page.locator('button.link').first().click(); await page.waitForTimeout(500);
  const m = modal();
  await m.locator('select[aria-label=Ligne]').selectOption({ index: 1 });
  await m.locator('select[aria-label=Stock]').selectOption({ index: 1 });
  await m.getByLabel('Quantité (kg)').fill('1000');
  await m.getByRole('button', { name: 'Réserver' }).click(); await page.waitForTimeout(900);
  must((await text()).includes('LOT-CACAO'), 'réservation absente');
  await page.keyboard.press('Escape');
});
await step('créer l\'expédition (sans véhicule)', async () => {
  await go('/commerce', 'Expéditions');
  await page.getByRole('button', { name: 'Nouvelle expédition' }).click(); await page.waitForTimeout(500);
  const m = modal(); const sel = m.locator('select');
  await sel.nth(0).selectOption({ index: 1 }); await sel.nth(1).selectOption({ index: 1 });
  await m.locator('input').first().fill('Abidjan, port'); await page.waitForTimeout(700);
  await m.getByLabel(/^Prévu/).fill('1000');
  await m.getByRole('button', { name: 'Créer', exact: true }).click(); await page.waitForTimeout(1000);
  must((await page.locator('tbody').innerText()).includes('Planifiée'), 'expédition planifiée absente');
});
await step('charger, puis départ refusé sans véhicule ni chauffeur', async () => {
  await page.locator('button.link').first().click(); await page.waitForTimeout(500);
  const m = modal();
  await m.getByRole('button', { name: 'Confirmer le chargement' }).click(); await page.waitForTimeout(900);
  await m.getByRole('button', { name: 'Départ' }).click(); await page.waitForTimeout(900);
  must(/Véhicule et conducteur requis/.test(await text()), 'refus du départ non affiché');
  expectedRefusals++;
});
await step('affecter véhicule et chauffeur, puis départ', async () => {
  const m = modal();
  await m.locator('select[aria-label=Véhicule]').selectOption({ index: 1 }); await m.locator('select[aria-label=Chauffeur]').selectOption({ index: 1 });
  await m.getByRole('button', { name: 'Affecter' }).click(); await page.waitForTimeout(900);
  await m.getByRole('button', { name: 'Départ' }).click(); await page.waitForTimeout(900);
  must((await text()).includes('En transit'), 'statut En transit absent');
});
await step('livraison avec écart : motif et responsable exigés', async () => {
  const m = modal();
  await m.getByLabel('Réceptionnaire').fill('M. Traoré'); await m.getByLabel(/^Livré/).fill('995');
  must(await m.getByRole('button', { name: 'Enregistrer la livraison' }).isDisabled(), 'bouton actif sans motif');
  await m.getByLabel('Motif de l\'écart').fill('Freinte au transport'); await m.getByLabel('Responsable de traitement').selectOption({ index: 1 });
  await m.getByRole('button', { name: 'Enregistrer la livraison' }).click(); await page.waitForTimeout(1000);
  must((await text()).includes('Livrée'), 'statut Livrée absent');
});
await step('validation refusée sans preuve de livraison', async () => {
  await modal().getByRole('button', { name: 'Valider la livraison' }).click(); await page.waitForTimeout(900);
  must(/Preuve de livraison manquante/.test(await text()), 'refus non affiché');
  expectedRefusals++;
});
await step('joindre la preuve puis valider', async () => {
  const m = modal();
  await m.locator('input[type=file]').setInputFiles(PROOF);
  await m.getByRole('button', { name: 'Joindre' }).click(); await page.waitForTimeout(1000);
  await m.getByRole('button', { name: 'Valider la livraison' }).click(); await page.waitForTimeout(1000);
  must((await text()).includes('Validée'), 'statut Validée absent');
  await page.keyboard.press('Escape');
});
await step('émettre la facture de 995 kg', async () => {
  await go('/commerce', 'Factures');
  await page.getByRole('button', { name: 'Émettre une facture' }).click(); await page.waitForTimeout(400);
  const m = modal(); await m.locator('select').first().selectOption({ index: 1 }); await page.waitForTimeout(1200);
  await m.getByLabel(/^Facturer/).fill('995');
  await m.getByRole('button', { name: 'Émettre', exact: true }).click(); await page.waitForTimeout(1000);
  must(/995\s?000/.test(await page.locator('tbody').innerText()), 'montant 995 000 absent');
});
await step('trop-perçu refusé puis encaissement en deux fois jusqu\'à « Payée »', async () => {
  await page.locator('button.link').first().click(); await page.waitForTimeout(500);
  const m = modal(); const pay = async (v) => { await m.getByLabel('Montant', { exact: true }).fill(v); await m.getByRole('button', { name: 'Enregistrer le paiement' }).click(); await page.waitForTimeout(900); };
  await pay('2000000'); must(/supérieur au solde/.test(await text()), 'trop-perçu non refusé'); expectedRefusals++;
  await pay('500000'); must((await text()).includes('Part. payée'), 'statut Part. payée absent');
  await pay('495000'); must((await text()).includes('Payée'), 'statut Payée absent');
  await page.keyboard.press('Escape');
});
await step('enregistrer et clôturer une réclamation', async () => {
  await go('/commerce', 'Réclamations');
  await page.getByRole('button', { name: 'Nouvelle réclamation' }).click(); await page.waitForTimeout(400);
  const m = modal(); await m.locator('select').first().selectOption({ index: 1 });
  await m.locator('textarea').fill('5 kg manquants à la livraison'); await m.getByRole('button', { name: 'Enregistrer' }).click(); await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Traiter' }).click(); await page.waitForTimeout(400);
  await modal().locator('textarea').fill('Avoir accordé'); await modal().getByRole('button', { name: 'Clôturer' }).click(); await page.waitForTimeout(900);
  must((await page.locator('tbody').innerText()).includes('Résolue'), 'statut Résolue absent');
});
await step('tableau de bord : indicateur de créances présent', async () => {
  await go('/');
  const t = await page.locator('main').innerText();
  must(/Créances clients/.test(t), 'indicateur absent');
});

// Les seuls refus attendus sont ceux que le parcours provoque volontairement.
const unexpected = problems.filter((p) => !/^HTTP 40[09] /.test(p));
const refusals = problems.filter((p) => /^HTTP 40[09] /.test(p));
await browser.close();
if (unexpected.length || refusals.length !== expectedRefusals) {
  console.log('Problèmes inattendus :', JSON.stringify({ unexpected, refusals, expectedRefusals }, null, 2)); process.exit(1);
}
console.log(`\n${ok} étapes réussies, ${expectedRefusals} refus métier attendus, aucune erreur inattendue`);
