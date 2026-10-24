// Captures du guide de formation : une série par profil, avec les comptes de la version de démonstration.
// Prérequis : `node backend/scripts/seed-demo-complet.js` (écrit /tmp/demo-accounts.json) et le portail servi sur WEB.
// Usage : WEB=http://127.0.0.1:4173 node e2e/captures-formation.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = process.env.WEB ?? 'http://127.0.0.1:4173';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'captures', 'formation');
fs.mkdirSync(OUT, { recursive: true });
const demo = JSON.parse(fs.readFileSync(process.env.DEMO_JSON ?? '/tmp/demo-accounts.json', 'utf8'));

// Coach, agent de terrain et collecteur se connectent uniquement par l'application mobile : pas de capture du portail pour eux.
// Pages à photographier par profil : [nom du fichier, route, onglet facultatif]
const PAGES = {
  coop_admin: [['accueil', '/'], ['pesees', '/pesees'], ['parametres', '/parametres'], ['producteurs', '/producteurs'], ['parcelles', '/parcelles'], ['convois', '/convois'], ['finances', '/finances'], ['equipe', '/equipe'], ['operations', '/operations'], ['rapports', '/rapports'], ['rapprochement', '/finances', 'Rapprochement bancaire'], ['envoi-auto', '/rapports', 'Envoi automatique'], ['compte', '/compte']],
  magasinier: [['accueil', '/'], ['pesees', '/pesees'], ['convois', '/convois'], ['stocks', '/stocks'], ['inventaire', '/inventaire'], ['operations', '/operations'], ['compte', '/compte']],
  caissier: [['accueil', '/'], ['caisse', '/caisse'], ['convois', '/convois'], ['finances', '/finances'], ['operations', '/operations']],
  comptable: [['accueil', '/'], ['comptabilite', '/comptabilite'], ['partenaires', '/partenaires'], ['finances', '/finances'], ['rapports', '/rapports']],
  direction: [['accueil', '/'], ['finances', '/finances'], ['prefinancement', '/prefinancement'], ['rapports', '/rapports'], ['operations', '/operations']],
  responsable_tracabilite: [['accueil', '/'], ['producteurs', '/producteurs'], ['declarations', '/declarations'], ['fiches-accompagnement', '/fiches-accompagnement'], ['missions', '/missions'], ['stocks', '/stocks']],
  responsable_cartographie: [['accueil', '/'], ['parcelles', '/parcelles'], ['cartographie', '/cartographie']],
  cartographe: [['accueil', '/'], ['parcelles', '/parcelles'], ['cartographie', '/cartographie']],
  responsable_magasin: [['accueil', '/'], ['convois', '/convois'], ['stocks', '/stocks'], ['inventaire', '/inventaire']],
  responsable_financier: [['accueil', '/'], ['finances', '/finances'], ['rapprochement', '/finances', 'Rapprochement bancaire'], ['prefinancement', '/prefinancement'], ['operations', '/operations']],
  responsable_qualite: [['accueil', '/'], ['qualite', '/qualite'], ['stocks', '/stocks']],
  responsable_logistique: [['accueil', '/'], ['convois', '/convois'], ['stocks', '/stocks']],
  auditeur: [['accueil', '/'], ['finances', '/finances'], ['rapports', '/rapports']],
  acheteur: [['accueil', '/'], ['commerce', '/commerce']],
  exportateur: [['accueil', '/'], ['modules-exportateurs', '/modules-exportateurs'], ['fiches-accompagnement', '/fiches-accompagnement']],
  adg: [['accueil', '/'], ['modules-formation', '/modules-formation'], ['modules-exportateurs', '/modules-exportateurs'], ['resultats-exportateurs', '/modules-exportateurs', 'Résultats (1)'], ['transmission-nature-cible', '/modules-exportateurs', null, 'tr:has-text("Séchage et stockage") button:has-text("Transmettre aux coachs")'], ['affectations', '/modules-exportateurs', 'Affectations aux producteurs'], ['producteurs', '/producteurs'], ['missions', '/missions'], ['rapports', '/rapports'], ['operations', '/operations']],
};

const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
const index = {};
for (const a of demo.accounts) {
  const list = PAGES[a.role]; if (!list) continue;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await ctx.newPage();
  await page.goto(WEB + '/'); await page.fill('input[type=email]', a.email); await page.fill('input[type=password]', demo.password); await page.click('button[type=submit]'); await page.waitForTimeout(1500);
  if (await page.locator('.org-list button').count()) { await page.locator('.org-list button').first().click(); await page.waitForTimeout(1200); }
  index[a.role] = [];
  for (const [name, route, tab, click] of list) {
    await page.goto(WEB + route); await page.waitForTimeout(900);
    if (tab) { const t = page.getByText(tab, { exact: true }).first(); if (await t.count()) { await t.click(); await page.waitForTimeout(800); } }
    if (click) { const b = page.locator(click).first(); if (await b.count()) { await b.click(); await page.waitForTimeout(900); } }
    const file = `${a.role}-${name}.png`;
    await page.screenshot({ path: path.join(OUT, file) });
    index[a.role].push({ name, route, tab: tab ?? null, file, visible: !(await page.locator('text=/Permission insuffisante|Accès refusé/').count()) });
    console.log('  ✓', file);
  }
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2));
