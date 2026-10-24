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
  await snap(page, 'caissier', 'session', 'Caisse : fonds disponible', 'La caissière se connecte par l\'écran de connexion du logiciel, comme tout utilisateur : la caisse n\'a ni ouverture, ni clôture. Le bandeau du haut affiche en permanence le **fonds disponible** : espèces + comptes bancaires.');
  await page.locator('.acc-head', { hasText: 'Opérations' }).click().catch(() => undefined); await page.waitForTimeout(300);
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
  await page.locator('.acc-head', { hasText: 'Solde délégué' }).click().catch(() => undefined); await page.waitForTimeout(300);
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

// ═══ 6 bis. Fiche d'accompagnement : producteurs des convois, export Excel, transmission à l'exportateur
console.log('6 bis. Fiche d\'accompagnement');
{
  const { page, go, close } = await actor('responsable_tracabilite');
  await go('/fiches-accompagnement');
  await snap(page, 'responsable_tracabilite', 'fiches-convois', 'Convois pesés : choisir les convois du chargement', 'Le menu **Fiches d\'accompagnement** liste les convois pesés au magasin avec leur nombre de producteurs. **Consulter** affiche les producteurs d\'un convoi ; **Exporter (Excel)** produit la fiche sur le modèle de la coopérative.');
  await page.locator('tbody tr:has(button:not([disabled]))').first().getByRole('button', { name: 'Consulter' }).click(); await page.waitForTimeout(1000);
  await snap(page, 'responsable_tracabilite', 'fiches-producteurs', 'Producteurs d\'un convoi', 'Nom et prénoms, genre, section, code planteur, date de livraison au magasin, poids net livré, sacs et n° de reçu : les colonnes de la fiche d\'accompagnement. Le poids net pesé est réparti entre les producteurs au prorata de leurs achats.', true);
  for (const cb of await page.locator('tbody input[type=checkbox]:not([disabled])').all()) await cb.check();
  await page.getByRole('button', { name: /Créer la fiche/ }).click(); await page.waitForTimeout(600);
  await modalOf(page).locator('input').first().fill('Traoré Moussa'); await modalOf(page).locator('input').nth(4).fill('BL-DEMO-2026'); await page.waitForTimeout(300);
  await snap(page, 'responsable_tracabilite', 'fiche-nouvelle', 'Créer la fiche du chargement', 'Cochez les convois du chargement puis **Créer la fiche** : les producteurs sont repris automatiquement. Renseignez le chauffeur, le camion, la remorque, le LOT ID DSE, le n° de connaissement, la date de départ, le type de cacao et les certifications.');
  await modalOf(page).getByRole('button', { name: 'Créer la fiche' }).click(); await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Transmettre à l'exportateur/ }).first().click(); await page.waitForTimeout(700);
  await modalOf(page).locator('select').selectOption({ label: `${demo.exporter.name} (exportateur)` }); await page.waitForTimeout(300);
  await snap(page, 'responsable_tracabilite', 'fiche-transmission', 'Transmettre la fiche à l\'exportateur', 'Le destinataire est l\'**exportateur lié** à la coopérative (lien accepté des deux côtés) : la fiche devient chez lui une livraison attendue. Une fiche peut aussi être **importée** (bouton *Importer une fiche (Excel)*) si elle a été remplie ailleurs sur le même modèle. Choisissez l\'exportateur : la fiche lui est transmise, il est notifié, et elle ne peut plus être modifiée.');
  await modalOf(page).getByRole('button', { name: 'Transmettre', exact: true }).click(); await page.waitForTimeout(1500);
  await close();
}

// ═══ 6 ter. Chez l'exportateur : pont bascule, analyse, bulletin de pesée, règlement
console.log('6 ter. Exportateur');
{
  const { page, go, close } = await actor('exp_admin');
  await go('/organisations-liees');
  await snap(page, 'exp_admin', 'coop-fournisseuses', 'L\'exportateur : coopératives fournisseuses', 'L\'exportateur est une **organisation à part entière** (ses employés, sa caisse, sa comptabilité, ses stocks) sans agents de terrain. L\'écran **Coopératives** donne, pour chaque coopérative qui lui livre, les livraisons en cours, les poids acceptés ou rejetés, ce qui reste à régler et ce qui est payé. Les liens se proposent avec le code de l\'autre organisation et s\'activent quand elle les accepte.');
  await close();
}
{
  const { page, go, close } = await actor('pont_bascule');
  await go('/livraisons');
  await snap(page, 'pont_bascule', 'livraison-attendue', 'Pont bascule : la livraison attendue', 'La fiche transmise par la coopérative apparaît ici (**Attendue**), avec le camion et le poids déclaré ; le responsable du pont bascule est notifié.');
  await page.getByRole('button', { name: "Peser l'entrée" }).first().click(); await page.waitForTimeout(500);
  const decl = Number((await page.locator('.modal').innerText()).match(/déclaré ([\d\s\u202f\u00a0,]+) kg/)?.[1]?.replace(/[\s\u202f\u00a0]/g, '').replace(',', '.') ?? 1000);
  await modalOf(page).getByLabel("Poids d'entrée (kg)").fill(String(decl + 9000)); await modalOf(page).getByLabel('Origine').fill('Hiré'); await modalOf(page).getByLabel('Transporteur').fill('Transports de démonstration'); await page.waitForTimeout(300);
  await snap(page, 'pont_bascule', 'pesee-entree', 'Pesée d\'entrée (camion chargé)', 'Le camion se présente chargé : on saisit le **poids brut** lu au pont bascule.');
  await modalOf(page).getByRole('button', { name: "Enregistrer l'entrée" }).click(); await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Peser la sortie' }).first().click(); await page.waitForTimeout(500);
  await modalOf(page).getByLabel('Poids de sortie (kg)').fill('9000'); await modalOf(page).getByLabel('Sacs déchargés').fill('100'); await modalOf(page).getByLabel('Sacs refusés').fill('1'); await modalOf(page).getByLabel('Tare des sacs acceptés (kg)').fill('60'); await modalOf(page).getByLabel('Pont de sortie').fill('PONT BASCULE 2'); await page.waitForTimeout(300);
  await snap(page, 'pont_bascule', 'pesee-sortie', 'Pesée de sortie (camion vide) : poids net', 'Une fois déchargé, le camion repasse au pont bascule : on saisit la **tare** ; le **poids net** (brut − tare) et l\'écart avec le poids déclaré s\'affichent.');
  await modalOf(page).getByRole('button', { name: 'Enregistrer la sortie' }).click(); await page.waitForTimeout(1200);
  await close();
}
{
  const { page, go, close } = await actor('analyste');
  await go('/livraisons');
  await page.getByRole('button', { name: 'Analyser' }).first().click(); await page.waitForTimeout(500);
  const M = modalOf(page); await M.getByLabel('Humidité (%)', { exact: true }).fill('7.8'); await M.getByLabel('Grainage').fill('109'); for (const [l, v] of [['Matières étrangères', '1.3'], ['Fèves brisées', '0.33'], ['Brisures', '1.7'], ['Déchet', '0.8'], ['Crabots', '2'], ['Fèves moisies', '3.33'], ['Fèves ardoisées', '4'], ['Fèves mitées', '0.33'], ['Fèves germées', '1'], ['Fèves plates', '2.33'], ['Fèves violettes', '4.66'], ['Résidus', '2.03'], ['FFA', '0']]) await M.getByLabel(`${l} (%)`, { exact: true }).fill(v); await M.getByLabel('Réfaction (kg)').fill('18'); await M.getByLabel('Classement (grade)').fill('GRADE 2'); await page.waitForTimeout(300);
  await snap(page, 'analyste', 'analyse', 'Analyse de la livraison', 'L\'analyste saisit l\'**humidité**, le grainage, les matières étrangères et tous les défauts (brisures, crabots, fèves moisies, ardoisées, mitées, germées, plates, violettes, résidus, FFA), la **réfaction**, le classement et la décision (acceptée ou refusée, avec motif obligatoire en cas de refus), puis produit le **bulletin de pesée**.');
  await modalOf(page).getByRole('button', { name: /produire le bulletin/ }).click(); await page.waitForTimeout(1200);
  const [pop] = await Promise.all([page.context().waitForEvent('page'), page.getByRole('button', { name: 'Bulletin' }).first().click()]); await pop.waitForTimeout(900);
  n += 1; { const file = `${String(n).padStart(2, '0')}-analyste-bulletin.png`; await pop.setViewportSize({ width: 900, height: 1100 }); await pop.screenshot({ path: path.join(OUT, file) });
    steps.push({ n, role: 'analyste', who: acc.analyste.name, title: 'Bulletin de pesée', text: 'Le bulletin de pesée de l\'exportateur reprend, dans l\'ordre : l\'indication connaissement, la pesée (entrée et sortie avec les ponts), l\'analyse, la livraison produit (poids brut, tares, **poids net livré**, réfaction, **poids net payé**, classement, manquants et écarts), le QR code et les trois visas (pont bascule, fournisseur, chef d\'usine). Il s\'imprime ou s\'enregistre en PDF.', file }); console.log('  ✓', file); }
  await pop.close(); await close();
}
{
  const { page, go, close } = await actor('exp_caissier');
  await go('/livraisons');
  await page.getByRole('button', { name: 'Régler' }).first().click(); await page.waitForTimeout(500);
  await modalOf(page).locator('input').first().fill('1000'); await modalOf(page).locator('input').nth(1).fill('VIR-2026-001'); await page.waitForTimeout(300);
  await snap(page, 'exp_caissier', 'reglement', 'Règlement de la coopérative', 'Pour une livraison **acceptée**, la caisse fixe le prix au kilo : le montant est le poids net × le prix. Il est communiqué à la coopérative ; l\'écriture comptable se passe dans Comptabilité.');
  await modalOf(page).getByRole('button', { name: 'Régler', exact: true }).last().click(); await page.waitForTimeout(1300);
  await close();
}
{
  const { page, go, close } = await actor('responsable_tracabilite');
  await go('/livraisons');
  await page.getByRole('tab', { name: /envoyées/ }).click().catch(() => {}); await page.waitForTimeout(800);
  await snap(page, 'responsable_tracabilite', 'suivi-livraison', 'La coopérative suit sa livraison', 'Dans **Livraisons → Mes livraisons envoyées**, la coopérative voit le poids net pesé chez l\'exportateur, l\'écart, la décision de l\'analyse, le bulletin et le règlement ; elle est notifiée à chaque étape.');
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
