// Navigateur : association des postes (code à 8 caractères), règle « obligatoire », poste inconnu bloqué, révocation immédiate.
import { chromium } from 'playwright-core';
import { WEB, PW, must, seedBase } from './lib.mjs';

const { email } = await seedBase();
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
const problems = []; let ok = 0;
const open = async () => { const p = await (await browser.newContext({ viewport: { width: 1300, height: 1000 } })).newPage(); p.on('pageerror', (e) => problems.push('erreur JavaScript : ' + e.message)); await p.goto(WEB + '/'); return p; };
const step = async (name, fn) => { try { await fn(); ok++; console.log('  ✓', name); } catch (e) { console.log('  ✗', name, '—', e.message.split('\n')[0]); await browser.close(); process.exit(1); } };
const signIn = async (p) => { if (!(await p.locator('input[type=email]').count())) { await p.waitForTimeout(800); if (!(await p.locator('input[type=email]').count())) return; } await p.fill('input[type=email]', email); await p.fill('input[type=password]', PW); await p.click('button[type=submit]'); await p.waitForTimeout(1500); if (await p.locator('.org-list button').count()) { await p.locator('.org-list button').first().click(); await p.waitForTimeout(1200); } };
const modal = (p) => p.locator('[role=dialog], .modal').first();
const gen = async (p, name) => {
  await p.getByRole('link', { name: /Équipe/ }).click(); await p.waitForTimeout(900);
  await p.getByRole('button', { name: 'Associer un poste' }).click(); await p.waitForTimeout(300);
  await modal(p).getByLabel('Nom du poste').fill(name);
  await modal(p).getByRole('button', { name: 'Générer le code' }).click(); await p.waitForTimeout(800);
  const code = (await modal(p).locator('[aria-live]').innerText()).trim();
  must(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), 'code mal formé : ' + code);
  await modal(p).getByRole('button', { name: 'Terminé' }).click(); await p.waitForTimeout(500);
  return code;
};
const pair = async (p, code) => { await p.getByRole('button', { name: /Associer ce poste/ }).first().click(); await p.getByLabel("Code d'association").fill(code); await p.getByRole('button', { name: 'Associer ce poste' }).last().click(); await p.waitForTimeout(1500); };

console.log('Association des postes dans le navigateur');
let admin = await open(), code1;
await step('l\'administrateur génère un code d\'association', async () => { await signIn(admin); code1 = await gen(admin, 'Caisse 01'); });
let caisse = await open();
await step('le poste « Caisse 01 » s\'associe avec le code puis se connecte', async () => { await pair(caisse, code1); await signIn(caisse); await caisse.getByRole('link', { name: /Équipe/ }).click(); await caisse.waitForTimeout(900); must((await caisse.innerText('main')).includes('Caisse 01'), 'poste absent de la liste'); });
let code2;
await step('depuis le poste associé : association obligatoire + second code', async () => {
  await caisse.getByLabel(/Rendre l'association obligatoire/).click(); await caisse.waitForTimeout(1500);
  must(await caisse.getByLabel(/Rendre l'association obligatoire/).isChecked(), 'règle non enregistrée');
  code2 = await gen(caisse, 'Magasin');
});
let inconnu = await open();
await step('un appareil inconnu est bloqué même avec le bon mot de passe', async () => {
  await signIn(inconnu); await inconnu.waitForTimeout(800);
  const t = await inconnu.innerText('body'); must(t.includes('pas associé') && await inconnu.getByLabel("Code d'association").count(), 'écran d\'association absent : ' + t.slice(0, 200));
});
await step('il s\'associe avec le second code et travaille', async () => {
  await inconnu.getByLabel("Code d'association").fill(code2); await inconnu.getByRole('button', { name: 'Associer ce poste' }).click(); await inconnu.waitForTimeout(1800);
  await signIn(inconnu); must(await inconnu.getByRole('link', { name: /Équipe/ }).count(), 'accès refusé après association');
});
await step('révocation du poste « Magasin » : bloqué aussitôt', async () => {
  await caisse.reload(); await caisse.waitForTimeout(1200);
  await caisse.getByRole('row', { name: /Magasin/ }).getByRole('button', { name: 'Révoquer' }).click(); await caisse.waitForTimeout(300);
  await modal(caisse).getByLabel('Motif').fill('Poste perdu'); await modal(caisse).getByRole('button', { name: /Confirmer|Valider|Révoquer/ }).last().click(); await caisse.waitForTimeout(1200);
  await inconnu.reload(); await inconnu.waitForTimeout(1500);
  must((await inconnu.innerText('body')).includes('pas associé'), 'poste révoqué encore autorisé');
});
await browser.close();
if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
console.log(`\n${ok} étapes réussies`);
