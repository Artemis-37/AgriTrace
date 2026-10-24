// Parcours exportateur dans le portail : création (API), pont bascule, analyse, règlement, coopérative fournisseuse. Variables : API, ADMIN_EMAIL, ADMIN_PASSWORD, WEB.
import { chromium } from '/home/claude/agritrace-github/web/node_modules/playwright-core/index.mjs';
import fs from 'fs';
const API = process.env.API, WEB = process.env.WEB || 'http://127.0.0.1:4173';
const demo = JSON.parse(fs.readFileSync('/tmp/demo-accounts.json', 'utf8')); const PWD = 'Exportateur-Test-2026!';
const call = async (m, p, { token, org, body } = {}) => { const r = await fetch(API + p, { method: m, headers: { ...(body && { 'content-type': 'application/json' }), ...(token && { authorization: 'Bearer ' + token }), ...(org && { 'x-organization-id': org }) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const tok = async (e, p) => (await call('POST', '/auth/login', { body: { email: e, password: p } })).access_token;
const sfx = Date.now().toString(36).slice(-5).toUpperCase(); let ok = 0, ko = 0; const check = (n, c) => { c ? ok++ : ko++; console.log(c ? '  ✓' : '  ✗', n); };
const PA = await tok(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
const ex = await call('POST', '/organizations', { token: PA, body: { code: 'EXP' + sfx, name: 'Exportateur Démo ' + sfx, kind: 'exporter' } }); const E = ex.id;
await call('POST', `/organizations/${E}/admins`, { token: PA, body: { email: `admin.${sfx}@exp.test`, full_name: 'Admin Exportateur', password: PWD } });
const EA = await tok(`admin.${sfx}@exp.test`, PWD); const mk = {};
for (const [code, name] of [['pont_bascule', 'Responsable Pont Bascule'], ['analyste', 'Analyste Labo'], ['caissier', 'Caissier Export']]) { const r = await call('POST', '/roles/standard', { token: EA, org: E, body: { code } }); await call('POST', '/users', { token: EA, org: E, body: { email: `${code}.${sfx}@exp.test`, full_name: name, password: PWD, role_id: r.id } }); mk[code] = `${code}.${sfx}@exp.test`; }
const acct = (r) => demo.accounts.find((a) => a.role === r).email; const CAD = await tok(acct('coop_admin'), demo.password), T = await tok(acct('responsable_tracabilite'), demo.password);
const lk = await call('POST', '/org-links', { token: CAD, org: demo.org, body: { code: 'EXP' + sfx, direction: 'supply_to' } }); await call('POST', `/org-links/${lk.id}/accept`, { token: EA, org: E });
const cv = (await call('GET', '/dispatch-sheets/convoys', { token: T, org: demo.org })).find((c) => c.producers > 0 && !c.sheets);
const sh = await call('POST', '/dispatch-sheets', { token: T, org: demo.org, body: { convoy_ids: [cv.id], bl_no: 'BL-UI-' + sfx } });
const b = await chromium.launch();
async function login(email, pw) { const p = await b.newPage({ viewport: { width: 1400, height: 880 } }); p.on('pageerror', (e) => console.log('  JS', e.message));
  await p.goto(WEB); await p.waitForTimeout(1200); await p.getByLabel(/e-?mail|identifiant/i).first().fill(email); await p.locator('input[type=password]').first().fill(pw); await p.keyboard.press('Enter'); await p.waitForTimeout(2500); return p; }
const go = async (p, path) => { await p.evaluate((x) => { history.pushState({}, '', x); dispatchEvent(new PopStateEvent('popstate')); }, path); await p.waitForTimeout(1500); };
// la coopérative transmet depuis le portail
const pt = await login(acct('responsable_tracabilite'), demo.password); await go(pt, '/fiches-accompagnement');
await pt.getByRole('tab', { name: /Fiches/ }).click().catch(() => {}); await pt.waitForTimeout(800);
await pt.getByRole('button', { name: /Transmettre/ }).first().click(); await pt.waitForTimeout(800);
check('le menu de transmission propose l\'exportateur lié', /Exportateur Démo/.test(await pt.locator('.modal').innerText()));
await pt.locator('.modal select').selectOption({ label: `Exportateur Démo ${sfx} (exportateur)` }); await pt.locator('.modal').getByRole('button', { name: 'Transmettre', exact: true }).click(); await pt.waitForTimeout(1500);
check('fiche transmise à l\'exportateur', /Transmise à Exportateur Démo/.test(await pt.locator('body').innerText()));
// administrateur de l'exportateur : menus
const pa = await login(`admin.${sfx}@exp.test`, PWD); const nav = await pa.locator('header + nav, nav').first().evaluate((e) => e.textContent);
check('exportateur : pas de menus des agents terrain (producteurs, délégués, missions)', !/Producteurs|Délégués|Missions|Données de terrain/.test(nav));
check('exportateur : modules de gestion conservés (caisse, comptabilité, stocks, équipe)', /Caisse/.test(nav) && /Comptabilité|Compta/.test(nav) && /Équipe|Equipe/.test(nav));
check('exportateur : écrans Livraisons et Coopératives', /Livraisons/.test(nav) && /Coopératives|Organisations liées/.test(nav));
await go(pa, '/organisations-liees'); await pa.screenshot({ path: '/tmp/exp-coops.png' });
check('écran Coopératives (exportateur)', /Coopératives/.test(await pa.locator('h1').first().innerText()));
// pont bascule
const pb = await login(mk.pont_bascule, PWD); await go(pb, '/livraisons');
check('pont bascule : livraison attendue', /Attendue/.test(await pb.locator('table').innerText()));
await pb.getByRole('button', { name: "Peser l'entrée" }).click(); await pb.waitForTimeout(500);
await pb.locator('.modal input').first().fill('20000'); await pb.getByRole('button', { name: "Enregistrer l'entrée" }).click(); await pb.waitForTimeout(1200);
check('entrée pesée', /Entrée pesée/.test(await pb.locator('table').innerText()));
await pb.getByRole('button', { name: 'Peser la sortie' }).click(); await pb.waitForTimeout(500);
await pb.getByLabel('Poids de sortie (kg)').fill('8000'); await pb.waitForTimeout(300); await pb.screenshot({ path: '/tmp/exp-sortie.png' });
check('poids net calculé à l\'écran', /poids net livré : 12/.test(await pb.locator('.modal').innerText()));
await pb.getByRole('button', { name: 'Enregistrer la sortie' }).click(); await pb.waitForTimeout(1200);
check('pesée terminée, pas de bouton d\'analyse pour le pont bascule', /Pesée terminée/.test(await pb.locator('table').innerText()) && !(await pb.getByRole('button', { name: 'Analyser' }).count()));
// analyste
const pn = await login(mk.analyste, PWD); await go(pn, '/livraisons');
await pn.getByRole('button', { name: 'Analyser' }).click(); await pn.waitForTimeout(500);
await pn.getByLabel('Humidité (%)', { exact: true }).fill('7.4'); await pn.screenshot({ path: '/tmp/exp-analyse.png' });
await pn.getByRole('button', { name: /produire le bulletin/ }).click(); await pn.waitForTimeout(1200);
check('analyse enregistrée, bulletin disponible', /Analysée/.test(await pn.locator('table').innerText()) && await pn.getByRole('button', { name: 'Bulletin' }).count() === 1);
const [pop] = await Promise.all([pn.context().waitForEvent('page'), pn.getByRole('button', { name: 'Bulletin' }).click()]); await pop.waitForTimeout(800);
check('bulletin de pesée au modèle de l\'exportateur (connaissement, pesée, analyse, livraison produit, visas)', /BULLETIN DE PESEE/.test(await pop.locator('body').innerText()) && /Poids Net Payé/.test(await pop.locator('body').innerText()) && /INDICATION CONNAISSEMENT/.test(await pop.locator('body').innerText()) && /Analyste Labo/.test(await pop.locator('body').innerText()));
await pop.screenshot({ path: '/tmp/exp-bulletin.png' });
// caissier
const pc = await login(mk.caissier, PWD); await go(pc, '/livraisons');
await pc.getByRole('button', { name: 'Régler' }).click(); await pc.waitForTimeout(400); await pc.locator('.modal input').first().fill('1500'); await pc.getByRole('button', { name: 'Régler', exact: true }).last().click(); await pc.waitForTimeout(1200);
check('règlement : livraison réglée', /Réglée/.test(await pc.locator('table').innerText()));
// retour à la coopérative
await go(pt, '/livraisons'); await pt.getByRole('tab', { name: /envoyées/ }).click().catch(() => {}); await pt.waitForTimeout(800);
const tx = await pt.locator('table').innerText(); check('la coopérative voit sa livraison réglée avec bulletin', /Réglée/.test(tx) && /Acceptée/.test(tx)); await pt.screenshot({ path: '/tmp/exp-suivi.png' });
console.log(`${ok} contrôles réussis, ${ko} en échec`); await b.close(); process.exit(ko ? 1 : 0);
