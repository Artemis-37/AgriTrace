// Test de bout en bout du navigateur : inventaire (comptage, écart, séparation des tâches) et cartographie (import simulé puis confirmé, anomalies, export).
//   API=... WEB=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node e2e/parcours-terrain.mjs
import { chromium } from 'playwright-core';
import { WEB, PW, must, seedBase } from './lib.mjs';

const { email, prod } = await seedBase();
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 }, acceptDownloads: true });
const problems = [];
page.on('pageerror', (e) => problems.push('erreur JavaScript : ' + e.message));
page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/v1/')) problems.push(`HTTP ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
let ok = 0, expectedRefusals = 0;
const step = async (name, fn) => { try { await fn(); ok++; console.log('  ✓', name); } catch (e) { console.log('  ✗', name, '—', e.message.split('\n')[0]); await page.screenshot({ path: 'e2e-echec.png' }).catch(() => undefined); await browser.close(); process.exit(1); } };
const modal = () => page.locator('[role=dialog], .modal').first();
const go = async (p, tab) => { await page.goto(WEB + p); await page.waitForTimeout(700); if (tab) { await page.getByText(tab, { exact: true }).first().click(); await page.waitForTimeout(600); } };

console.log('Inventaire et cartographie dans le navigateur');
await step('connexion', async () => {
  await page.goto(WEB + '/');
  await page.fill('input[type=email]', email); await page.fill('input[type=password]', PW); await page.click('button[type=submit]');
  await page.waitForTimeout(1500);
  if (await page.locator('.org-list button').count()) { await page.locator('.org-list button').first().click(); await page.waitForTimeout(1200); }
  must(await page.getByText('Inventaire').count(), 'menu Inventaire absent');
});

// ---- Inventaire ----
await step('ouvrir un inventaire : le théorique est figé à 1300 kg', async () => {
  await go('/inventaire');
  await page.getByRole('button', { name: 'Ouvrir un inventaire' }).click(); await page.waitForTimeout(400);
  await modal().locator('select').selectOption({ index: 1 });
  await modal().getByRole('button', { name: 'Ouvrir', exact: true }).click(); await page.waitForTimeout(1000);
  must(/1\s?300\s?kg/.test(await modal().innerText()), 'théorique 1 300 kg absent');
});
await step('saisir 1295 kg avec un motif, puis soumettre', async () => {
  const m = modal();
  await m.getByLabel(/^Compté/).fill('1295'); await m.getByLabel(/^Motif/).fill('Freinte de séchage');
  await m.getByRole('button', { name: 'Enregistrer le comptage' }).click(); await page.waitForTimeout(900);
  must(/5\s?kg/.test(await m.innerText()), 'écart de 5 kg absent');
  await m.getByRole('button', { name: 'Soumettre' }).click(); await page.waitForTimeout(900);
  must((await m.innerText()).includes('Soumis'), 'statut Soumis absent');
});
await step('l\'approbation par la même personne est refusée', async () => {
  const m = modal();
  await m.getByRole('button', { name: 'Approuver' }).click(); await page.waitForTimeout(400);
  await page.locator('textarea').last().fill('Écart accepté'); await page.getByRole('button', { name: /Confirmer|Valider|Envoyer/ }).last().click(); await page.waitForTimeout(900);
  must(!(await m.innerText()).includes('Approuvé'), 'inventaire approuvé par son propre compteur');
  expectedRefusals++;
});

// ---- Cartographie ----
const square = (lng, lat, d = 0.0009) => ({ type: 'Polygon', coordinates: [[[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]] });
const geojson = JSON.stringify({ type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { producer_code: prod.internal_code, culture: 'cacao', declared_area_ha: 1 }, geometry: square(-5.9, 6.8) },
  { type: 'Feature', properties: { producer_code: 'INCONNU', culture: 'cacao', declared_area_ha: 1 }, geometry: square(-5.8, 6.8) },
] });
await step('import simulé : 1 création, 1 rejet, rien d\'écrit', async () => {
  await go('/cartographie', 'Importer');
  await page.locator('input[type=file]').setInputFiles({ name: 'parcelles.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(geojson) });
  await page.getByRole('button', { name: 'Analyser' }).click(); await page.waitForTimeout(1800);
  const t = await page.locator('main').innerText();
  must(/producteur_inconnu/.test(t), 'rejet du producteur inconnu absent');
  must(/Confirmer l'import \(1 création/.test(t), 'bouton de confirmation absent', t.slice(0, 300));
});
await step('confirmer l\'import : la parcelle apparaît', async () => {
  await page.getByRole('button', { name: /Confirmer l'import/ }).click(); await page.waitForTimeout(2000);
  await go('/parcelles');
  must((await page.locator('tbody').innerText()).includes(prod.internal_code), 'parcelle importée absente');
});
await step('export GeoJSON téléchargé', async () => {
  await go('/cartographie', 'Exporter');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: 'Télécharger' }).click()]);
  must(dl.suggestedFilename().endsWith('.geojson'), 'nom de fichier inattendu', dl.suggestedFilename());
  const buf = await (await import('node:fs/promises')).readFile(await dl.path());
  const fc = JSON.parse(buf.toString());
  must(fc.features.length === 1 && !JSON.stringify(fc).includes('phone'), 'contenu de l\'export inattendu');
});
await step('carte : la parcelle importée est dessinée et sélectionnable', async () => {
  await go('/cartographie');
  must((await page.locator('main').innerText()).includes('Parcelles sur la carte'), 'onglet Carte absent');
  must(await page.locator('svg[aria-label="Carte des parcelles"] path').count() === 1, 'une parcelle attendue sur la carte');
  await page.locator('svg[aria-label="Carte des parcelles"] path').first().click(); await page.waitForTimeout(300);
  must(/producteur P\d+/.test(await page.locator('[role=status]').first().innerText()), 'fiche de la parcelle absente');
});
await step('anomalies : contrôle périodique sans anomalie', async () => {
  await go('/cartographie', 'Anomalies');
  await page.getByRole('button', { name: 'Lancer le contrôle périodique' }).click(); await page.waitForTimeout(1500);
  must(/1 parcelle\(s\) examinée\(s\), 0 nouvelle\(s\) anomalie\(s\)/.test(await page.locator('main').innerText()), 'rapport du contrôle inattendu');
});

const unexpected = problems.filter((p) => !/^HTTP 40[0-9] /.test(p));
const refusals = problems.filter((p) => /^HTTP 40[0-9] /.test(p));
await browser.close();
if (unexpected.length || refusals.length < expectedRefusals) { console.log('Problèmes :', JSON.stringify({ unexpected, refusals, expectedRefusals }, null, 2)); process.exit(1); }
console.log(`\n${ok} étapes réussies, ${refusals.length} refus métier (dont ${expectedRefusals} provoqués par le parcours), aucune erreur inattendue`);
