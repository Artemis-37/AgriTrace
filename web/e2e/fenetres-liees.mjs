import { chromium } from '/home/claude/agritrace-github/web/node_modules/playwright-core/index.mjs';
import fs from 'fs';
const acc = JSON.parse(fs.readFileSync('/tmp/demo-accounts.json','utf8')).accounts;
const find = (re) => acc.find(a => re.test(JSON.stringify(a)));
const b = await chromium.launch();
async function login(email) { const p = await b.newPage({ viewport: { width: 1400, height: 880 } });
  await p.goto('http://127.0.0.1:4173/'); await p.waitForTimeout(1200);
  await p.getByLabel(/e-?mail|identifiant/i).first().fill(email); await p.locator('input[type=password]').first().fill('Demo-AgriTrace-2026!'); await p.keyboard.press('Enter'); await p.waitForTimeout(2200); return p; }
const go = async (p, path) => { await p.evaluate((x) => { history.pushState({}, '', x); dispatchEvent(new PopStateEvent('popstate')); }, path); await p.waitForTimeout(1500); };
let ok = 0, ko = 0; const check = (n, c) => { c ? ok++ : ko++; console.log(c ? '  ✓' : '  ✗', n); };
// 1. déclarations -> fiche producteur
const t = find(/tracabilit/i); const p1 = await login(t.email); await go(p1, '/declarations');
await p1.locator('.peek-link').first().click(); await p1.waitForTimeout(1200);
check('fiche producteur ouverte par-dessus', await p1.locator('.peek').isVisible());
check('fil d\'Ariane : origine › titre', /Déclarations.*Producteur/.test(await p1.locator('.peek-crumbs').innerText()));
check('superficie visible dans la fiche', /superficie/i.test(await p1.locator('.peek-body').innerText()));
await p1.screenshot({ path: '/tmp/peek1.png' });
await p1.keyboard.press('Escape'); await p1.waitForTimeout(400);
check('Échap ferme et ramène à la liste', !(await p1.locator('.peek').count()) && await p1.locator('table').first().isVisible());
// 2. caissière : bandeau -> évolution compte, puis fermeture
const c = find(/caiss/i); const p2 = await login(c.email); await go(p2, '/caisse');
await p2.locator('.solde-bar .peek-link').nth(1).click(); await p2.waitForTimeout(1500);
check('évolution du compte bancaire en fenêtre liée', /évolution/i.test(await p2.locator('.peek-body').innerText()));
await p2.screenshot({ path: '/tmp/peek2.png' });
await p2.getByRole('button', { name: /Fermer/ }).click(); await p2.waitForTimeout(300);
check('✕ Fermer revient à l\'écran d\'origine', !(await p2.locator('.peek').count()));
// 3. caisse : file -> fiche délégué
await p2.locator('.peek-link').filter({ hasText: /Brahima|Yao|Sylla|Kouassi/ }).first().click().catch(() => {}); await p2.waitForTimeout(1500);
const n = await p2.locator('.peek').count(); check('délégué de la file de la caisse -> fiche de suivi', n === 1 && /Fiche de suivi/.test(await p2.locator('.peek-body').innerText()));
if (n) await p2.screenshot({ path: '/tmp/peek3.png' });
// 4. menus du haut : navigation normale ; sous-rubrique de la caisse : fenêtre centrée
await go(p2, '/'); await p2.locator('.menu-top', { hasText: 'Opérations' }).click(); await p2.locator('.menu-drop a', { hasText: /^.?\s*Caisse/ }).click(); await p2.waitForTimeout(1500);
check('menu du haut : navigation comme avant', new URL(p2.url()).pathname === '/caisse' && !(await p2.locator('.peek').count()));
await p2.locator('.acc-head', { hasText: 'Solde délégué' }).click(); await p2.locator('.accordion button', { hasText: /Solde et fiche/ }).click(); await p2.waitForTimeout(1200);
check('sous-rubrique ouverte en fenêtre contextuelle', await p2.locator('.peek').count() === 1);
console.log(ok + ' ok, ' + ko + ' ko'); await b.close();
