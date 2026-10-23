// Parcours complet simulé, du terrain à l'exportateur, avec les comptes de la version de démonstration.
// Le téléphone du délégué est simulé par l'API (mêmes appels que l'application) ; chaque étape du portail est jouée
// dans le navigateur, formulaires remplis, et photographiée : docs/captures/parcours/NN-<profil>-<étape>.png + index.json.
// Prérequis : `node backend/scripts/seed-demo-complet.js` (écrit /tmp/demo-accounts.json), API sur $API et portail sur $WEB.
//   API=http://localhost:3111/v1 WEB=http://127.0.0.1:4173 node e2e/parcours-complet.mjs
import { chromium } from 'playwright-core';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API ?? 'http://localhost:3111/v1';
const WEB = process.env.WEB ?? 'http://127.0.0.1:4173';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'captures', 'parcours');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const demo = JSON.parse(fs.readFileSync(process.env.DEMO_JSON ?? '/tmp/demo-accounts.json', 'utf8'));
const PW = demo.password;
const acc = Object.fromEntries(demo.accounts.map((a) => [a.role, a]));
const must = (c, m, x) => { if (!c) throw new Error(m + (x ? ' : ' + JSON.stringify(x).slice(0, 300) : '')); };
const key = (p) => `${p}-${crypto.randomBytes(5).toString('hex')}`;
const iso = (n = 0) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function call(method, p, { token, org, body } = {}) {
  const h = {}; if (token) h.authorization = `Bearer ${token}`; if (org) h['x-organization-id'] = org; if (body) h['content-type'] = 'application/json';
  const r = await fetch(API + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  must(r.status < 400, `${method} ${p} → ${r.status}`, j); return j;
}
const login = async (email) => (await call('POST', '/auth/login', { body: { email, password: PW } })).access_token;
const ORG = demo.org;
const tok = async (role) => ({ token: await login(acc[role].email), org: ORG });

const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
const steps = [];
let n = 0;
async function actor(role) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  ! erreur JS', role, e.message));
  await page.goto(WEB + '/'); await page.fill('input[type=email]', acc[role].email); await page.fill('input[type=password]', PW); await page.click('button[type=submit]'); await page.waitForTimeout(1800);
  if (await page.locator('.org-list button').count()) { await page.locator('.org-list button').first().click(); await page.waitForTimeout(1200); }
  const go = async (p) => { await page.evaluate((x) => { history.pushState({}, '', x); window.dispatchEvent(new PopStateEvent('popstate')); }, p); await page.waitForTimeout(1100); };
  return { page, go, close: () => ctx.close() };
}
/** Enregistre une étape du parcours : capture + texte de guide. */
async function snap(page, role, slug, title, text, full = false) {
  n += 1; const file = `${String(n).padStart(2, '0')}-${role}-${slug}.png`;
  if (full) {
    // Page entière : on agrandit la fenêtre à la hauteur du contenu (les barres fixes restent en haut et en bas).
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: 1280, height: Math.min(h, 2600) }); await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, file) });
    await page.setViewportSize({ width: 1280, height: 760 }); await page.waitForTimeout(300);
  } else await page.screenshot({ path: path.join(OUT, file) });
  steps.push({ n, role, who: acc[role]?.name ?? role, title, text, file });
  console.log('  ✓', file);
}
const mobile = (role, file, title, text) => { n += 1; steps.push({ n, role, who: acc[role]?.name ?? 'Délégué', title, text, mobile: file }); console.log('  ✓ (téléphone)', file); };
const modalOf = (page) => page.locator('[role=dialog], .modal').first();

// ── Données de référence
const A = await tok('coop_admin') .catch(async () => ({ token: await login(acc.coop_admin.email), org: ORG }));
const producers = (await call('GET', '/producers?limit=10', A)); const plist = producers.items ?? producers.rows ?? producers;
const vc = (await call('GET', '/value-chains', A))[0];
const camp = (await call('GET', '/campaigns', A)).find((c) => c.status === 'open') ?? (await call('GET', '/campaigns', A))[0];
const wh = (await call('GET', '/warehouses', A))[0];
const COL = await tok('collecteur');

// ═══ 1. Téléphone du délégué : deux achats, puis le convoi qui les transporte
console.log('1. Téléphone du délégué');
mobile('collecteur', 'collecteur-choix-producteur.png', 'Choisir le producteur', 'Dans **Acheter**, le délégué cherche le producteur par code ou nom : l\'application affiche son code, sa filière et sa campagne.');
mobile('collecteur', 'collecteur-achat-saisi.png', 'Saisir l\'achat', 'Poids, nombre de sacs et **n° du reçu** remis au producteur. L\'achat est enregistré sur le téléphone, même sans réseau.');
const declIds = [];
for (const [i, [kg, bags]] of [[520, 8], [780, 12]].entries()) {
  const id = crypto.randomUUID(); declIds.push(id);
  await call('POST', '/purchase-declarations', { ...COL, body: { id, idempotency_key: key('decl'), producer_id: plist[i].id, value_chain_id: vc.id, campaign_id: camp.id, operation_date: iso(), quantity: String(kg), unit: 'kg', bags, purchase_receipt_no: `A-00041${i + 2}` } });
  await call('POST', `/purchase-declarations/${id}/submit`, COL);
}
mobile('collecteur', 'collecteur-historique.png', 'Historique des achats', 'Après la synchronisation, les achats apparaissent dans l\'historique du délégué avec leur état (reçus, en vérification, acceptés).');
mobile('collecteur', 'collecteur-convoi-saisi.png', 'Déclarer le convoi', 'Le délégué annonce le convoi : n° de connaissement (ou numéro automatique), chauffeur, camion, sacs et poids annoncés.');
const convoy = await call('POST', '/convoys', { ...COL, body: { idempotency_key: key('cv'), driver_name: 'Traoré Moussa', truck_no: 'AB 1234 CI', declared_bags: 20, declared_kg: '1300', declaration_ids: declIds } });
must(convoy.convoy_no, 'convoi non créé', convoy);
const CV = convoy.convoy_no;

// ═══ 2. Responsable traçabilité : vérification des achats
console.log('2. Vérification des achats');
{
  const { page, go, close } = await actor('responsable_tracabilite');
  await go('/declarations');
  await snap(page, 'responsable_tracabilite', 'declarations', 'Achats reçus du téléphone', 'Les achats déclarés par le délégué arrivent dans **Déclarations d\'achat** avec le statut « Reçue ».');
  for (let k = 0; k < 2; k++) {
    await page.getByRole('button', { name: 'Mettre en vérification' }).first().click(); await page.waitForTimeout(500);
    if (k === 0) await snap(page, 'responsable_tracabilite', 'verification', 'Mise en vérification', 'On met l\'achat en vérification (confirmation demandée), puis on l\'accepte ou on demande une correction.');
    await modalOf(page).getByRole('button', { name: 'Confirmer' }).click(); await page.waitForTimeout(900);
  }
  for (let k = 0; k < 2; k++) {
    await page.getByRole('button', { name: 'Accepter', exact: true }).first().click(); await page.waitForTimeout(500);
    await modalOf(page).getByRole('button', { name: 'Confirmer' }).click(); await page.waitForTimeout(900);
  }
  await snap(page, 'responsable_tracabilite', 'acceptes', 'Achats acceptés', 'Les achats acceptés sont désormais reconnus : ils peuvent être pesés au magasin.');
  await close();
}

// ═══ 3. Magasinier : pesée du convoi déclaré, puis pesée d'un convoi non déclaré
console.log('3. Pesées au magasin');
{
  const { page, go, close } = await actor('magasinier');
  await go('/pesees');
  await snap(page, 'magasinier', 'liste', 'Pesées du magasin', 'La liste des pesées (traitées ou non par la caisse). Le bouton **Enregistrer une pesée** ouvre la saisie.');
  await page.getByRole('button', { name: 'Enregistrer une pesée' }).click(); await page.waitForTimeout(800);
  const form = page.locator('main');
  const del1 = acc.collecteur;
  const opts = await form.getByLabel(/^Délégué \(recherche par nom\)/).locator('option').allInnerTexts();
  await form.getByLabel(/^Délégué \(recherche par nom\)/).selectOption({ label: opts.find((o) => o.includes('Brahima')) });
  await page.waitForTimeout(400);
  await form.getByLabel(/^Magasin/).selectOption({ index: 1 });
  await form.getByLabel(/^Produit/).selectOption({ label: 'Cacao (fèves)' });
  await form.getByLabel(/^N° de connaissement/).fill(CV); await page.waitForTimeout(600);
  await form.getByLabel(/^Poids \(kg\)/).fill('1312'); await form.getByLabel(/^Nombre de sacs reçus/).fill('20'); await form.getByLabel(/^Sacs déchargés/).fill('20'); await form.getByLabel(/^Qualité \/ grade/).fill('A');
  await page.waitForTimeout(500);
  await snap(page, 'magasinier', 'pesee-declaree', 'Pesée d\'un convoi déclaré', 'On choisit le délégué (ou on saisit son code), le n° de connaissement : chauffeur, camion, sacs et poids déclarés sont repris, avec le **contenu déclaré** (achats chargés). On saisit le poids pesé et les sacs déchargés ; le poids net est calculé (poids − sacs déchargés).', true);
  await page.getByRole('button', { name: /Valider la réception/ }).click(); await page.waitForTimeout(2500);
  await snap(page, 'magasinier', 'pesee-enregistree', 'Pesée enregistrée', 'La réception est transmise à la caisse. Elle apparaît dans la liste avec son bulletin de pesée.', true);
  // Convoi non déclaré : le délégué existe mais n'a pas déclaré ce convoi
  const d2 = demo.delegate2;
  await page.getByRole('button', { name: /Retour à la liste/ }).click(); await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Enregistrer une pesée' }).click(); await page.waitForTimeout(800);
  const opts2 = await form.getByLabel(/^Délégué \(recherche par nom\)/).locator('option').allInnerTexts();
  await form.getByLabel(/^Délégué \(recherche par nom\)/).selectOption({ label: opts2.find((o) => o.includes(d2.name)) }); await page.waitForTimeout(400);
  await form.getByLabel(/^Magasin/).selectOption({ index: 1 });
  await form.getByLabel(/^Produit/).selectOption({ label: 'Cacao (fèves)' });
  await form.getByLabel(/^N° de connaissement/).fill('CV-NC-001'); await page.waitForTimeout(500);
  await form.getByLabel(/^Sacs déclarés/).fill('30'); await form.getByLabel(/^Poids déclaré \(kg\)/).fill('1950');
  await form.getByLabel(/^Chauffeur/).fill('Ouattara Seydou'); await form.getByLabel(/^N° du camion/).fill('CD 5678 CI');
  await form.getByLabel(/^Poids \(kg\)/).fill('1962'); await form.getByLabel(/^Nombre de sacs reçus/).fill('30'); await form.getByLabel(/^Sacs déchargés/).fill('30'); await form.getByLabel(/^Qualité \/ grade/).fill('A');
  await page.waitForTimeout(500);
  await snap(page, 'magasinier', 'pesee-non-declaree', 'Pesée d\'un convoi non déclaré', 'Le délégué existe mais n\'a pas déclaré ce convoi : le magasinier le choisit dans la liste, saisit le n° de connaissement et les informations du bordereau (chauffeur, camion, sacs et poids déclarés). Le convoi est créé à la réception.', true);
  await page.getByRole('button', { name: /Valider la réception/ }).click(); await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /Retour à la liste/ }).click(); await page.waitForTimeout(1200);
  await snap(page, 'magasinier', 'pesees-liste', 'Les deux pesées', 'Le convoi déclaré et le convoi non déclaré figurent dans la liste, en attente de traitement par la caisse.');
  await close();
}

// ═══ 3 bis. Administrateur : tarifs du délégué (transport, retenue) préenregistrés dans son profil
console.log('3 bis. Tarifs du délégué');
{
  const { page, go, close } = await actor('coop_admin');
  await go('/delegues');
  await page.locator('.pick-list button', { hasText: 'Brahima' }).first().click(); await page.waitForTimeout(600);
  await page.getByRole('tab', { name: 'Transport' }).click().catch(async () => { await page.getByText('Transport', { exact: true }).first().click(); }); await page.waitForTimeout(700);
  await snap(page, 'coop_admin', 'tarif-transport', 'Délégué : onglet Transport', 'Le **coût de transport au kilo** du délégué est préenregistré dans son profil, onglet **Transport**. Seul l\'administrateur le saisit ; la caisse le reprend à chaque règlement sans pouvoir le modifier.');
  await page.getByRole('tab', { name: /Retenues/ }).click().catch(async () => { await page.getByText(/^Retenues/).first().click(); }); await page.waitForTimeout(700);
  await snap(page, 'coop_admin', 'tarif-retenue', 'Délégué : onglet Retenues', 'La **retenue au kilo** (mise en compte) est préenregistrée dans l\'onglet **Retenues**, également par l\'administrateur seul.');
  await close();
}

// ═══ 4. Caissier : session de caisse, règlement des deux pesées
console.log('4. Caisse');
{
  const { page, go, close } = await actor('caissier');
  await go('/caisse');
  await page.getByText('Ouvrir / fermer la caisse', { exact: true }).first().click().catch(() => undefined); await page.waitForTimeout(800);
  await snap(page, 'caissier', 'session', 'Session de caisse', 'Avant de payer, la caisse est ouverte avec son fonds de caisse (une session ouverte est exigée pour tout mouvement d\'espèces).');
  await page.getByText('Traiter une pesée / régler un achat', { exact: true }).first().click().catch(() => undefined); await page.waitForTimeout(900);
  await snap(page, 'caissier', 'a-traiter', 'Pesées à traiter', 'La file des réceptions pesées et non encore réglées.');
  for (const [no, last] of [[CV, false], ['CV-NC-001', true]]) {
    await page.locator('tr', { hasText: no }).getByRole('button', { name: 'Traiter' }).click(); await page.waitForTimeout(600);
    const m = modalOf(page);
    must(await m.getByLabel(/P\.U\./).isDisabled(), 'le P.U. ne doit pas être modifiable par le caissier');
    must(await m.getByLabel(/Retenue au kg/).isDisabled() && await m.getByLabel(/Coût de transport/).isDisabled(), 'transport et retenue ne doivent pas être modifiables par le caissier');
    if (!last) await snap(page, 'caissier', 'traiter', 'Règlement d\'une pesée', 'Le P.U. (prix d\'achat au kg) est celui **fixé par l\'administrateur** pour la traite : il s\'affiche mais le caissier ne peut pas le modifier. Le **coût de transport** et la **retenue au kg** viennent eux aussi du profil du délégué (préenregistrés par l\'administrateur) et sont affichés sans pouvoir être saisis ; avec le P.U., ils donnent le net à payer, porté au compte du délégué.');
    await m.getByRole('button', { name: 'Enregistrer le net à payer' }).click(); await page.waitForTimeout(1800);
  }
  await page.getByText('Solde et fiche des délégués', { exact: true }).first().click().catch(() => undefined); await page.waitForTimeout(1000);
  await snap(page, 'caissier', 'soldes', 'Solde des délégués', 'Après règlement, le compte de chaque délégué est crédité du net à payer ; la fiche détaille livraisons, avances et soldes.');
  await close();
}

// ═══ 5. Clôture du compte du délégué et reversement de la mise en compte (approbation de l'administrateur)
console.log('5. Mise en compte');
{
  const { page, go, close } = await actor('caissier');
  await go('/mise-en-compte');
  await snap(page, 'caissier', 'mise-en-compte', 'Mise en compte des délégués', 'Pour chaque délégué : somme retenue, reversée, en attente et disponible. Une fois la campagne terminée, le compte du délégué est **clôturé**.');
  await page.locator('tr', { hasText: 'Brahima' }).getByRole('button', { name: 'Clôturer le compte' }).click(); await page.waitForTimeout(500);
  await snap(page, 'caissier', 'cloture', 'Clôturer le compte du délégué', 'La clôture du compte du délégué (fin de campagne) ouvre la possibilité de reverser sa mise en compte ; une nouvelle livraison rouvre le compte.');
  await modalOf(page).getByRole('button', { name: 'Clôturer' }).click(); await page.waitForTimeout(1200);
  await page.locator('tr', { hasText: 'Brahima' }).getByRole('button', { name: 'Reverser…' }).click(); await page.waitForTimeout(700);
  const m = modalOf(page);
  await m.getByRole('radio', { name: 'Chèque', exact: true }).check(); await page.waitForTimeout(400);
  const bankSel = m.getByLabel('Compte bancaire débité');
  if (await bankSel.count()) { const o = await bankSel.locator('option').allInnerTexts(); if (o.length > 1) await bankSel.selectOption({ index: 1 }); await m.getByLabel('N° du chèque').fill('CH-004512'); }
  await page.waitForTimeout(400);
  await snap(page, 'caissier', 'reverser', 'Reverser la mise en compte', 'Le montant disponible peut être reversé **sur le compte du délégué, par chèque, en espèces ou vers un autre compte**. La demande est soumise à l\'administrateur de la coopérative.');
  const ok = await m.getByRole('button', { name: /Soumettre/ }).isEnabled();
  if (!ok) { await m.getByRole('radio', { name: 'Sur le compte du délégué' }).check(); }
  await m.getByRole('button', { name: /Soumettre/ }).click(); await page.waitForTimeout(1200);
  await close();
}
{
  const { page, go, close } = await actor('coop_admin');
  await go('/mise-en-compte'); await page.getByRole('tab', { name: 'Demandes de reversement' }).click(); await page.waitForTimeout(900);
  await snap(page, 'coop_admin', 'demande', 'Demande à approuver', 'L\'administrateur voit la demande (délégué, montant, destination, demandeur) et l\'**approuve ou la refuse** avec un motif. Le demandeur ne peut pas approuver sa propre demande.');
  await page.getByRole('button', { name: 'Approuver' }).first().click(); await page.waitForTimeout(1500);
  await snap(page, 'coop_admin', 'approuvee', 'Reversement approuvé', 'À l\'approbation, le mouvement financier et l\'écriture comptable (débit 4781 « Retenues sur règlements des délégués ») sont passés.');
  await close();
}

// ═══ 6. Comptable : écritures et journaux
console.log('6. Comptabilité');
{
  const { page, go, close } = await actor('comptable');
  await go('/comptabilite');
  await page.getByText('Journal des achats', { exact: true }).first().click().catch(() => undefined); await page.waitForTimeout(1000);
  await snap(page, 'comptable', 'journal-achats', 'Journal des achats', 'Chaque pesée réglée a passé son écriture d\'achat : produit acheté, transport, compte du délégué et retenue.');
  await page.getByText('Journal de caisse', { exact: true }).first().click().catch(() => undefined); await page.waitForTimeout(1000);
  await snap(page, 'comptable', 'journal-caisse', 'Journal de caisse', 'Les mouvements de caisse, y compris les reversements en espèces approuvés.');
  await close();
}

// ═══ 7. Stock, vente et circuit exportateur
console.log('7. Stock, vente et exportateur');
for (const [role, route, slug, title, text, tab] of [
  ['responsable_magasin', '/stocks', 'stock', 'Stock mis à jour', 'Les pesées réglées alimentent le stock du magasin ; chaque lot garde sa traçabilité jusqu\'au producteur.'],
  ['acheteur', '/commerce', 'commerce', 'Vente aux acheteurs', 'L\'acheteur suit contrats et commandes ; les quantités vendues sortent du stock.'],
  ['adg', '/modules-exportateurs', 'modules', 'Modules proposés par l\'exportateur', 'L\'exportateur propose ses modules ; l\'ADG les transmet aux coachs.'],
  ['adg', '/modules-exportateurs', 'resultats', 'Résultats des coachs', 'Les résultats saisis par les coachs sur le terrain sont transmis à l\'exportateur.', 'Résultats (1)'],
  ['exportateur', '/modules-exportateurs', 'suivi', 'Suivi par l\'exportateur', 'L\'exportateur suit ses propositions et reçoit les résultats transmis : la boucle du terrain à l\'exportateur est bouclée.'],
]) {
  const { page, go, close } = await actor(role);
  await go(route);
  if (tab) { const t = page.getByText(tab, { exact: true }).first(); if (await t.count()) { await t.click(); await page.waitForTimeout(800); } }
  await snap(page, role, slug, title, text);
  await close();
}
mobile('coach', 'coach-module-resultats.png', 'Résultats saisis sur le terrain', 'Le coach saisit le résultat de la séance (village, participants, note moyenne) sur son téléphone ; il remonte à l\'ADG puis à l\'exportateur.');

await browser.close();
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ convoy: CV, convoy_non_declare: 'CV-NC-001', steps }, null, 2));
console.log(`\n${steps.length} étapes, ${steps.filter((s) => s.file).length} captures du portail.`);
