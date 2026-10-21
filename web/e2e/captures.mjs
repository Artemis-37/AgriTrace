// Captures d'écran du portail pour les guides (docs/captures). Données fictives créées pour l'occasion.
// Usage : API=… WEB=… ADMIN_EMAIL=… ADMIN_PASSWORD=… node e2e/captures.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { API, WEB, PW, call, seedBase } from './lib.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'captures');
fs.mkdirSync(OUT, { recursive: true });
const { email, J, vc, prod, colEmail } = await seedBase();
// Logo fictif de la coopérative de démonstration (visible en tête du portail)
{ const f = new FormData(); f.append('file', new Blob([fs.readFileSync(path.join(OUT, '..', 'brand', 'logo-cooperative-demo.png'))]), 'logo.png');
  const r = await fetch(API + '/organization/logo', { method: 'PUT', headers: { authorization: 'Bearer ' + J.token, 'x-organization-id': J.org }, body: f }); if (!r.ok) console.log('logo :', r.status); }

// Données de démonstration : trois parcelles dont deux se chevauchent, une couche de zone protégée dont l'une des parcelles touche le bord
const X = -5.7, Y = 6.8;
const sq = (lon, lat, s) => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + s, lat], [lon + s, lat + s], [lon, lat + s], [lon, lat]]] });
const mk = (g) => call('POST', '/parcels', { ...J, body: { idempotency_key: 'cap-' + crypto.randomUUID(), producer_id: prod.id, value_chain_id: vc.id, declared_area_ha: '1', geometry: g, confirm_not_duplicate: true } });
await mk(sq(X, Y, 0.0010)); await mk(sq(X + 0.0006, Y + 0.0004, 0.0010)); await mk(sq(X + 0.004, Y + 0.002, 0.0012)); await mk(sq(X + 0.0095, Y + 0.0015, 0.0010));
const zone = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { NAME: 'Forêt classée (exemple)', DESIG_ENG: 'Classified Forest', IUCN_CAT: 'IV', STATUS_YR: 1935 }, geometry: sq(X + 0.0100, Y - 0.001, 0.006) }] }));
{ const f = new FormData(); f.append('file', new Blob([zone]), 'zone.geojson'); f.append('name', 'Aires protégées (exemple)'); f.append('source', 'Données fictives'); f.append('license', 'Démonstration');
  const r = await fetch(API + '/geo/layers', { method: 'POST', headers: { authorization: 'Bearer ' + J.token, 'x-organization-id': J.org }, body: f }); if (!r.ok) console.log('couche :', r.status); }
await call('POST', '/geo/checks/run', J);

const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
let ctx, page;
const open = async () => { ctx = await browser.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 }); page = await ctx.newPage(); };
const login = async (mail) => {
  if (ctx) await ctx.close(); await open();
  await page.goto(WEB + '/'); await page.fill('input[type=email]', mail); await page.fill('input[type=password]', PW); await page.click('button[type=submit]'); await page.waitForTimeout(1500);
  if (await page.locator('.org-list button').count()) { await page.locator('.org-list button').first().click(); await page.waitForTimeout(1200); }
};
const shot = async (name, p, tab, after) => {
  await page.goto(WEB + p); await page.waitForTimeout(900);
  if (tab) { await page.getByText(tab, { exact: true }).first().click(); await page.waitForTimeout(800); }
  if (after) await after();
  await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log('  ✓', name);
};

await open(); await page.goto(WEB + '/'); await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, 'connexion.png') }); console.log('  ✓ connexion');

await login(email);
await shot('tableau-de-bord', '/');
await shot('producteurs', '/producteurs');
await shot('parcelles', '/parcelles');
await page.setViewportSize({ width: 1280, height: 1020 });
await shot('cartographie-carte', '/cartographie', 'Carte');
await page.setViewportSize({ width: 1280, height: 760 });
await shot('cartographie-anomalies', '/cartographie', 'Anomalies');
await shot('cartographie-zones', '/cartographie', 'Zones protégées');
await shot('cartographie-import', '/cartographie', 'Importer');
await shot('stocks-lots', '/stocks');
await shot('inventaire', '/inventaire');
await shot('convois', '/convois');
await shot('commerce', '/commerce');
await shot('finances', '/finances');
await shot('rapports', '/rapports');
await shot('qualite', '/qualite');
await shot('equipe', '/equipe');
await shot('operations', '/operations');
await shot('missions', '/missions');
await shot('declarations', '/declarations');

await login(colEmail);
await shot('collecteur-mes-achats', '/mes-achats');
await shot('collecteur-mon-stock', '/mon-stock');
await shot('collecteur-historique', '/historique');
await browser.close();
console.log(fs.readdirSync(OUT).length + ' captures dans docs/captures');
