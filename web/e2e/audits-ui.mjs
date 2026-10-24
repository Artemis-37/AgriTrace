// Parcours d'audit dans le portail : supervision, mission, partages, constats, réponse, clôture. Variables : API, ADMIN_EMAIL, ADMIN_PASSWORD, WEB.
import { chromium } from '/home/claude/agritrace-github/web/node_modules/playwright-core/index.mjs';
import fs from 'fs';
const API = process.env.API, WEB = process.env.WEB || 'http://127.0.0.1:4173';
const demo = JSON.parse(fs.readFileSync('/tmp/demo-accounts.json', 'utf8')); const PWD = 'Exportateur-Test-2026!';
const call = async (m, p, { token, org, body } = {}) => { const r = await fetch(API + p, { method: m, headers: { ...(body && { 'content-type': 'application/json' }), ...(token && { authorization: 'Bearer ' + token }), ...(org && { 'x-organization-id': org }) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const tok = async (e, p) => (await call('POST', '/auth/login', { body: { email: e, password: p } })).access_token;
const sfx = Date.now().toString(36).slice(-5).toUpperCase(); let ok = 0, ko = 0; const check = (n, c) => { c ? ok++ : ko++; console.log(c ? '  ✓' : '  ✗', n); };
const PA = await tok(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
const acct = (r) => demo.accounts.find((a) => a.role === r).email; const CAD = await tok(acct('coop_admin'), demo.password), T = await tok(acct('responsable_tracabilite'), demo.password);
const b = await chromium.launch();
const reopen = async (p) => { await p.reload(); await p.waitForTimeout(1500); await p.getByRole('button', { name: 'Ouvrir' }).first().click(); await p.waitForTimeout(1200); };
async function login(email, pw) { const p = await b.newPage({ viewport: { width: 1400, height: 880 } }); p.on('pageerror', (e) => console.log('  JS', e.message));
  await p.goto(WEB); await p.waitForTimeout(1200); await p.getByLabel(/e-?mail|identifiant/i).first().fill(email); await p.locator('input[type=password]').first().fill(pw); await p.keyboard.press('Enter'); await p.waitForTimeout(2500); return p; }
const go = async (p, path) => { await p.evaluate((x) => { history.pushState({}, '', x); dispatchEvent(new PopStateEvent('popstate')); }, path); await p.waitForTimeout(1500); };
const ex = await call('POST', '/organizations', { token: PA, body: { code: 'AUD' + sfx, name: 'Exportateur Audit ' + sfx, kind: 'exporter' } }); const E = ex.id;
await call('POST', `/organizations/${E}/admins`, { token: PA, body: { email: `admin.${sfx}@aud.test`, full_name: 'Auditeur Principal', password: PWD } });
const EA = await tok(`admin.${sfx}@aud.test`, PWD);
const coopCode = (await call('GET', '/organizations', { token: CAD })).find((o) => o.id === demo.org).code;
await call('POST', '/supervisions', { token: EA, org: E, body: { code: coopCode } });
// la coopérative accepte la supervision depuis le portail
const pc = await login(acct('coop_admin'), demo.password); await go(pc, '/audits');
check('la coopérative a le menu Audits', /Audits/.test(await pc.locator('body').innerText()));
await pc.getByRole('tab', { name: /Supervision/ }).click(); await pc.waitForTimeout(800);
check('demande de supervision visible', /Exportateur Audit/.test(await pc.locator('table').innerText()) && /Me supervise/.test(await pc.locator('table').innerText()));
await pc.getByRole('button', { name: 'Accepter' }).click(); await pc.waitForTimeout(1200);
check('supervision acceptée', /Active/.test(await pc.locator('table').innerText()));
await pc.screenshot({ path: '/tmp/aud-supervision.png' });
// l'exportateur programme et démarre l'audit
const pe = await login(`admin.${sfx}@aud.test`, PWD); await go(pe, '/audits');
await pe.getByRole('button', { name: 'Programmer un audit' }).click(); await pe.waitForTimeout(800);
await pe.locator('.modal select').first().selectOption({ index: 1 });
await pe.getByLabel('Intitulé de la mission').fill('Audit traçabilité et pesées'); await pe.getByRole('checkbox', { name: 'Pesées', exact: true }).check();
await pe.screenshot({ path: '/tmp/aud-programmer.png' });
await pe.getByRole('button', { name: 'Programmer', exact: true }).click(); await pe.waitForTimeout(1500);
check('audit programmé, détail ouvert', /AU-\d{4}-\d{4}/.test(await pe.locator('h1').innerText()));
await pe.getByRole('button', { name: /Démarrer/ }).click(); await pe.waitForTimeout(1200);
check('audit en cours', /En cours/.test(await pe.locator('body').innerText()));
// la coopérative désigne un participant (elle-même) et partage un extrait
await pc.reload(); await pc.waitForTimeout(1500); await pc.getByRole('tab', { name: /Missions/ }).click(); await pc.waitForTimeout(500);
await pc.getByRole('button', { name: 'Ouvrir' }).first().click(); await pc.waitForTimeout(1200);
check('la coopérative n\'est pas encore désignée', /Non désigné/.test(await pc.locator('body').innerText()));
await pc.locator('select').first().selectOption({ index: 1 }); await pc.getByRole('button', { name: 'Désigner' }).click(); await pc.waitForTimeout(1200);
check('la coopérative est désormais participante', /Vous êtes participant/.test(await pc.locator('body').innerText()));
await pc.getByRole('tab', { name: /Données partagées/ }).click(); await pc.waitForTimeout(500);
await pc.getByRole('button', { name: /Partager un extrait/ }).click(); await pc.waitForTimeout(800);
await pc.getByLabel('Titre').fill('Achats déclarés 2026'); await pc.locator('.modal select').nth(1).selectOption({ index: 1 });
await pc.screenshot({ path: '/tmp/aud-partage.png' });
await pc.getByRole('button', { name: 'Partager', exact: true }).click(); await pc.waitForTimeout(1500);
check('extrait partagé', /Achats déclarés 2026/.test(await pc.locator('table').innerText()));
// l'exportateur consulte (lecture journalisée) et saisit un constat
await reopen(pe);
await pe.getByRole('tab', { name: /Données partagées/ }).click(); await pe.waitForTimeout(600);
await pe.getByRole('button', { name: 'Consulter' }).first().click(); await pe.waitForTimeout(1200);
check('l\'exportateur lit l\'extrait figé', /Extrait figé le/.test(await pe.locator('.modal').innerText()));
await pe.screenshot({ path: '/tmp/aud-extrait.png' }); await pe.getByRole('button', { name: 'Fermer', exact: true }).last().click();
await pe.getByRole('tab', { name: /Constats/ }).click(); await pe.waitForTimeout(500);
await pe.getByRole('button', { name: 'Ajouter un constat' }).click(); await pe.waitForTimeout(600);
await pe.getByLabel('Exigence contrôlée').fill('Registre de pesée tenu à jour'); await pe.getByLabel('Constat', { exact: true }).fill('Trois pesées sans bulletin signé.'); await pe.getByLabel('Résultat').selectOption('major');
await pe.getByRole('button', { name: 'Ajouter', exact: true }).click(); await pe.waitForTimeout(1200);
check('constat saisi', /Majeure/.test(await pe.locator('table').innerText()));
await pe.getByRole('button', { name: /Publier le rapport/ }).click(); await pe.waitForTimeout(1200);
await pe.screenshot({ path: '/tmp/aud-constats.png' });
// la coopérative répond
await reopen(pc); await pc.getByRole('tab', { name: /Constats/ }).click(); await pc.waitForTimeout(600);
check('la coopérative voit le constat publié', /Registre de pesée/.test(await pc.locator('table').innerText()));
await pc.getByRole('button', { name: 'Répondre' }).click(); await pc.waitForTimeout(600);
await pc.getByLabel('Votre réponse').fill('Bulletins retrouvés et signés.'); await pc.getByLabel('Plan d\'action').fill('Contrôle hebdomadaire des signatures');
await pc.getByRole('button', { name: 'Envoyer la réponse' }).click(); await pc.waitForTimeout(1200);
check('réponse enregistrée', /Réponse reçue/.test(await pc.locator('table').innerText()));
await pc.getByRole('tab', { name: /Journal/ }).click(); await pc.waitForTimeout(600);
check('la coopérative voit que l\'exportateur a lu son extrait', /Auditeur Principal/.test(await pc.locator('table').innerText()));
await pc.screenshot({ path: '/tmp/aud-journal.png' });
// vérification et clôture
await reopen(pe); await pe.getByRole('tab', { name: /Constats/ }).click(); await pe.waitForTimeout(600);
await pe.getByRole('button', { name: 'Vérifier' }).click(); await pe.waitForTimeout(1000);
await pe.getByRole('button', { name: 'Clore', exact: true }).click(); await pe.waitForTimeout(600);
await pe.getByLabel('Synthèse de clôture').fill('Audit clos : non-conformité corrigée.'); await pe.getByRole('button', { name: 'Clore', exact: true }).last().click(); await pe.waitForTimeout(1200);
check('audit clos', /Clos/.test(await pe.locator('body').innerText()));
console.log(`${ok} contrôles réussis, ${ko} en échec`); await b.close(); process.exit(ko ? 1 : 0);
