/* Exportateur (organisation à part entière), liens entre organisations, livraison : pont bascule → analyse → bulletin → règlement. Utilise la démo (seed-demo-complet).
   Variables : API, ADMIN_EMAIL, ADMIN_PASSWORD (administrateur de plateforme), DEMO_JSON. */
const fs = require('fs');
const API = process.env.API; const demo = JSON.parse(fs.readFileSync(process.env.DEMO_JSON || '/tmp/demo-accounts.json', 'utf8'));
let ok = 0, ko = 0;
const check = (n, c, d) => { if (c) { ok++; console.log('  ✓', n); } else { ko++; console.log('  ✗', n, d ? JSON.stringify(d).slice(0, 260) : ''); } };
async function call(m, p, { token, org, body } = {}) {
  const r = await fetch(API + p, { method: m, headers: { ...(body && { 'content-type': 'application/json' }), ...(token && { authorization: 'Bearer ' + token }), ...(org && { 'x-organization-id': org }) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status, body: b };
}
const loginE = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const login = (role) => loginE(demo.accounts.find((a) => a.role === role).email, demo.password);
const PWD = 'Exportateur-Test-2026!';
(async () => {
  const sfx = Date.now().toString(36).slice(-5).toUpperCase();
  const PA = await loginE(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  // 1. L'administrateur de plateforme crée l'exportateur
  const ex = await call('POST', '/organizations', { token: PA, body: { code: 'EXP' + sfx, name: 'Exportateur Test ' + sfx, country_code: 'CI', kind: 'exporter' } });
  check('création d\'une organisation de type exportateur', ex.status === 201 && ex.body.kind === 'exporter', ex.body);
  const E = ex.body.id;
  const adm = await call('POST', `/organizations/${E}/admins`, { token: PA, body: { email: `admin.${sfx}@exportateur.test`, full_name: 'Admin Exportateur', password: PWD } });
  check('premier administrateur de l\'exportateur', adm.status === 201, adm.body);
  const EA = await loginE(`admin.${sfx}@exportateur.test`, PWD);
  // 2. Rôles et équipe de l'exportateur
  const roles = {};
  for (const code of ['pont_bascule', 'analyste', 'caissier']) { const r = await call('POST', '/roles/standard', { token: EA, org: E, body: { code } }); roles[code] = r.body.id; check(`rôle type « ${code} » créé chez l'exportateur`, r.status === 201 && r.body.id, r.body); }
  const mk = async (code, name) => { const email = `${code}.${sfx}@exportateur.test`; const r = await call('POST', '/users', { token: EA, org: E, body: { email, full_name: name, password: PWD, role_id: roles[code] } }); check(`compte ${name} créé`, r.status === 201, r.body); return loginE(email, PWD); };
  const PB = await mk('pont_bascule', 'Resp Pont Bascule'), AN = await mk('analyste', 'Analyste Labo'), CA = await mk('caissier', 'Caissier Export');
  const me = await call('GET', '/organizations', { token: EA });
  check('la liste des organisations indique le type', me.body.find((o) => o.id === E)?.kind === 'exporter', me.body);
  // 3. Lien coopérative → exportateur
  const T = await login('responsable_tracabilite'), CAD = await login('coop_admin'); const C = demo.org;
  check('sans le droit « liens », impossible de proposer', (await call('POST', '/org-links', { token: T, org: C, body: { code: 'EXP' + sfx, direction: 'supply_to' } })).status === 403);
  const lk = await call('POST', '/org-links', { token: CAD, org: C, body: { code: 'EXP' + sfx, direction: 'supply_to' } });
  check('la coopérative propose un lien (elle livre à l\'exportateur)', lk.status === 201 && lk.body.status === 'pending', lk.body);
  check('le lien en attente ne permet pas encore de livrer', !((await call('GET', '/org-links/destinations', { token: T, org: C })).body ?? []).some((o) => o.id === E));
  check('la coopérative ne peut pas accepter son propre lien', (await call('POST', `/org-links/${lk.body.id}/accept`, { token: CAD, org: C })).status === 403);
  const seen = await call('GET', '/org-links', { token: EA, org: E });
  check('l\'exportateur voit la demande (côté destinataire)', seen.body.some((l) => l.id === lk.body.id && l.my_side === 'receiver' && !l.requested_by_me), seen.body);
  check('l\'exportateur accepte', (await call('POST', `/org-links/${lk.body.id}/accept`, { token: EA, org: E })).status === 201);
  const dest = (await call('GET', '/org-links/destinations', { token: T, org: C })).body;
  check('destinations de la coopérative : l\'exportateur lié y figure', dest.some((o) => o.id === E && o.kind === 'exporter'), dest);
  check('l\'exportateur ne peut pas livrer à la coopérative (lien à sens unique)', ((await call('GET', '/org-links/destinations', { token: EA, org: E })).body ?? []).length === 0);
  // 4. Fiche → transmission à l'exportateur
  const convs = (await call('GET', '/dispatch-sheets/convoys', { token: T, org: C })).body.filter((c) => c.producers > 0 && !c.sheets);
  check('des convois pesés sans fiche existent', convs.length >= 1, convs.length);
  const sh = await call('POST', '/dispatch-sheets', { token: T, org: C, body: { convoy_ids: [convs[0].id], bl_no: 'BL-LIV-' + sfx, lot_id_dse: 'DSE-' + sfx } });
  check('fiche créée', sh.status === 201, sh.body);
  const bad = await call('POST', `/dispatch-sheets/${sh.body.id}/transmit`, { token: T, org: C, body: { destination_org_id: '00000000-0000-4000-8000-000000000000' } });
  check('transmission refusée vers une organisation sans lien', bad.status === 400, bad.body);
  const both = await call('POST', `/dispatch-sheets/${sh.body.id}/transmit`, { token: T, org: C, body: {} });
  check('un destinataire est obligatoire', both.status === 400, both.body);
  const tr = await call('POST', `/dispatch-sheets/${sh.body.id}/transmit`, { token: T, org: C, body: { destination_org_id: E } });
  check('transmission à l\'exportateur', tr.status === 201 && tr.body.status === 'transmitted', tr.body);
  // 5. Chez l'exportateur
  const lst = (await call('GET', '/deliveries', { token: PB, org: E })).body;
  check('le pont bascule voit la livraison attendue', lst.length === 1 && lst[0].status === 'arrived' && lst[0].source_sheet_no === sh.body.number && /^DL-\d{4}-\d{5}$/.test(lst[0].number), lst);
  const D = lst[0].id;
  check('les notifications arrivent au pont bascule', JSON.stringify((await call('GET', '/notifications', { token: PB, org: E })).body).includes('Livraison de'));
  check('l\'analyste ne peut pas peser', (await call('POST', `/deliveries/${D}/weigh-in`, { token: AN, org: E, body: { gross_kg: 9000 } })).status === 403);
  check('analyse impossible avant la pesée', (await call('POST', `/deliveries/${D}/analysis`, { token: AN, org: E, body: { moisture_pct: 7, decision: 'accepted' } })).status === 409);
  check('sortie impossible avant l\'entrée', (await call('POST', `/deliveries/${D}/weigh-out`, { token: PB, org: E, body: { tare_kg: 5000 } })).status === 409);
  const decl = Number(lst[0].declared_kg);
  const w1 = await call('POST', `/deliveries/${D}/weigh-in`, { token: PB, org: E, body: { gross_kg: decl + 8000, origin: 'Hiré', transporter: 'Transports Test', bridge_in: 'PONT 1' } });
  check('pesée d\'entrée (brut)', w1.status === 201 && w1.body.status === 'weighing_in', w1.body);
  check('tare supérieure au brut refusée', (await call('POST', `/deliveries/${D}/weigh-out`, { token: PB, org: E, body: { tare_kg: decl + 9000 } })).status === 422);
  const w2 = await call('POST', `/deliveries/${D}/weigh-out`, { token: PB, org: E, body: { tare_kg: 8000, bags_discharged: 100, bags_refused: 2, sack_tare_kg: 40, pallet_tare_kg: 10, bridge_out: 'PONT 2' } });
  check('pesée de sortie : brut livré = entrée − sortie ; net livré = brut − tares', w2.status === 201 && Math.abs(Number(w2.body.net_kg) - decl) < 0.002 && Math.abs(Number(w2.body.net_delivered_kg) - (decl - 50)) < 0.002 && Math.abs(Number(w2.body.variance_kg) + 50) < 0.002 && w2.body.status === 'weighed', w2.body);
  check('le pont bascule ne peut pas analyser', (await call('POST', `/deliveries/${D}/analysis`, { token: PB, org: E, body: { moisture_pct: 7, decision: 'accepted' } })).status === 403);
  check('le rejet exige un motif', (await call('POST', `/deliveries/${D}/analysis`, { token: AN, org: E, body: { moisture_pct: 12, decision: 'rejected' } })).status === 422);
  check('bulletin indisponible avant l\'analyse', (await call('GET', `/deliveries/${D}/bulletin`, { token: AN, org: E })).status === 409);
  const an = await call('POST', `/deliveries/${D}/analysis`, { token: AN, org: E, body: { moisture_pct: 7.2, bean_count: 98, defects: { mouldy: 1, slaty: 2, insect: 0.5, residues: 2, crabots: 2 }, refaction_kg: 18, grade: 'GRADE 2', decision: 'accepted' } });
  check('analyse enregistrée, bulletin numéroté, poids net payé = net livré − réfaction', an.status === 201 && an.body.status === 'analysed' && /^BP-\d{4}-\d{5}$/.test(an.body.bulletin_no) && Math.abs(Number(an.body.net_payable_kg) - (decl - 50 - 18)) < 0.002, an.body);
  const bu = await call('GET', `/deliveries/${D}/bulletin`, { token: AN, org: E });
  check('bulletin : poids, analyse, signataires', bu.status === 200 && bu.body.analyst_name === 'Analyste Labo' && bu.body.weigher_name === 'Resp Pont Bascule' && Number(bu.body.net_kg) > 0 && bu.body.issuer?.name && bu.body.origin === 'Hiré' && bu.body.bridge_out === 'PONT 2' && Number(bu.body.bags_refused) === 2, bu.body);
  check('l\'analyste ne règle pas', (await call('POST', `/deliveries/${D}/settle`, { token: AN, org: E, body: { unit_price: 1500 } })).status === 403);
  const st = await call('POST', `/deliveries/${D}/settle`, { token: CA, org: E, body: { unit_price: 1500, payment_ref: 'VIR-1' } });
  check('règlement : montant = poids net payé × prix', st.status === 201 && st.body.status === 'settled' && Math.abs(Number(st.body.amount) - Number(st.body.net_payable_kg) * 1500) < 0.01, st.body);
  check('règlement unique', (await call('POST', `/deliveries/${D}/settle`, { token: CA, org: E, body: { unit_price: 1 } })).status === 409);
  const sup = (await call('GET', '/deliveries/suppliers', { token: EA, org: E })).body;
  check('écran « Coopératives » : synthèse par fournisseur', sup.length === 1 && sup[0].deliveries === 1 && Number(sup[0].paid) === Number(st.body.amount), sup);
  // 6. Retour vers la coopérative
  const sent = (await call('GET', '/deliveries/sent', { token: T, org: C })).body;
  check('la coopérative suit sa livraison (poids net, décision, bulletin, règlement)', sent.some((d) => d.id === D && d.decision === 'accepted' && d.status === 'settled' && d.bulletin_no), sent);
  check('la coopérative ne voit pas les autres livraisons de l\'exportateur', sent.every((d) => d.source_org_id === C));
  check('la coopérative lit son bulletin', (await call('GET', `/deliveries/${D}/bulletin`, { token: T, org: C })).status === 200);
  check('la coopérative ne peut pas peser chez l\'exportateur', (await call('POST', `/deliveries/${D}/weigh-in`, { token: CAD, org: C, body: { gross_kg: 1 } })).status === 404);
  check('notification de retour à la coopérative', JSON.stringify((await call('GET', '/notifications', { token: T, org: C })).body).includes('réglée'));
  // 7. Isolation : l'exportateur ne voit pas les données de la coopérative
  check('l\'exportateur n\'a aucun producteur de la coopérative', ((await call('GET', '/producers', { token: EA, org: E })).body?.items ?? (await call('GET', '/producers', { token: EA, org: E })).body ?? []).length === 0);
  check('un compte de la coopérative ne peut pas utiliser l\'organisation de l\'exportateur', (await call('GET', '/deliveries', { token: T, org: E })).status === 403);
  // 8. Coopérative ↔ coopérative (sens inverse)
  const rev = await call('POST', '/org-links', { token: EA, org: E, body: { code: 'EXP' + sfx, direction: 'supply_to' } });
  check('lien vers soi-même refusé', rev.status === 400, rev.body);
  const rl = await call('POST', `/org-links/${lk.body.id}/revoke`, { token: CAD, org: C });
  check('révocation du lien', rl.status === 201, rl.body);
  check('plus de destination après révocation', !((await call('GET', '/org-links/destinations', { token: T, org: C })).body ?? []).some((o) => o.id === E));
  // Coopérative ↔ coopérative, dans les deux sens
  const c2 = await call('POST', '/organizations', { token: PA, body: { code: 'COOP' + sfx, name: 'Coopérative Voisine ' + sfx, country_code: 'CI' } });
  check('seconde coopérative créée (type par défaut : coopérative)', c2.status === 201 && c2.body.kind === 'cooperative', c2.body);
  await call('POST', `/organizations/${c2.body.id}/admins`, { token: PA, body: { email: `admin.c2.${sfx}@coop.test`, full_name: 'Admin Coop 2', password: PWD } });
  const A2 = await loginE(`admin.c2.${sfx}@coop.test`, PWD);
  const lk2 = await call('POST', '/org-links', { token: A2, org: c2.body.id, body: { code: demo.org_code || (await call('GET', '/organizations', { token: CAD })).body.find((o) => o.id === C).code, direction: 'receive_from', bidirectional: true } });
  check('lien coopérative ↔ coopérative proposé par la destinataire', lk2.status === 201, lk2.body);
  check('acceptation par la coopérative fournisseuse', (await call('POST', `/org-links/${lk2.body.id}/accept`, { token: CAD, org: C })).status === 201);
  check('chacune peut livrer à l\'autre (lien bidirectionnel)', (await call('GET', '/org-links/destinations', { token: A2, org: c2.body.id })).body.some((o) => o.id === C) && (await call('GET', '/org-links/destinations', { token: T, org: C })).body.some((o) => o.id === c2.body.id));
  const sh2 = await call('POST', '/dispatch-sheets', { token: T, org: C, body: { convoy_ids: [convs[1].id], bl_no: 'BL-C2C-' + sfx } });
  const tr2 = await call('POST', `/dispatch-sheets/${sh2.body.id}/transmit`, { token: T, org: C, body: { destination_org_id: c2.body.id } });
  check('une coopérative livre à une autre coopérative', sh2.status === 201 && tr2.status === 201, [sh2.body, tr2.body]);
  const c2roles = await call('POST', '/roles/standard', { token: A2, org: c2.body.id, body: { code: 'magasinier' } });
  const d2 = (await call('GET', '/deliveries', { token: A2, org: c2.body.id })).body;
  check('la coopérative destinataire reçoit la livraison (même circuit)', d2.length === 1 && d2[0].source_org_name && d2[0].status === 'arrived', d2);
  check('elle pèse (administrateur de coopérative : droits complets)', (await call('POST', `/deliveries/${d2[0].id}/weigh-in`, { token: A2, org: c2.body.id, body: { gross_kg: Number(d2[0].declared_kg) + 5000 } })).status === 201);
  // 9. Refoulement : le volume revient au stock de la coopérative fournisseuse
  const kgOf = async () => (await call('GET', '/stock-state', { token: CAD, org: C })).body.reduce((a, r) => a + Number(r.kg ?? 0), 0);
  const before = await kgOf(), declared = Number(d2[0].declared_kg);
  check('le refoulement exige un motif', (await call('POST', `/deliveries/${d2[0].id}/refuse`, { token: A2, org: c2.body.id, body: {} })).status === 400);
  check('sans le droit de refouler, refusé', (await call('POST', `/deliveries/${d2[0].id}/refuse`, { token: T, org: C, body: { reason: 'Test' } })).status === 403);
  const rf = await call('POST', `/deliveries/${d2[0].id}/refuse`, { token: A2, org: c2.body.id, body: { reason: 'Humidité excessive, chargement refusé' } });
  check('chargement refoulé', rf.status === 201 && rf.body.status === 'refused' && rf.body.decision === 'rejected', rf.body);
  check('un chargement refoulé ne se refoule pas deux fois', (await call('POST', `/deliveries/${d2[0].id}/refuse`, { token: A2, org: c2.body.id, body: { reason: 'Encore' } })).status === 409);
  check('le volume revient dans le stock de la coopérative', Math.abs((await kgOf()) - before - declared) < 0.01, [before, declared, await kgOf()]);
  const sent2 = (await call('GET', '/deliveries/sent', { token: T, org: C })).body.find((x) => x.id === d2[0].id);
  check('la coopérative voit « refoulée » et le motif', sent2?.status === 'refused' && /Humidité/.test(sent2.refusal_reason), sent2);
  check('notification de refoulement à la coopérative', JSON.stringify((await call('GET', '/notifications', { token: T, org: C })).body).includes('refoulé'));
  const sh3 = await call('POST', '/dispatch-sheets', { token: T, org: C, body: { convoy_ids: [convs[1].id], bl_no: 'BL-REUSE-' + sfx } });
  check('les convois refoulés servent à un autre chargement', sh3.status === 201, sh3.body);
  const tr3 = await call('POST', `/dispatch-sheets/${sh3.body.id}/transmit`, { token: T, org: C, body: { destination_org_id: c2.body.id } });
  check('nouvelle transmission avec les mêmes convois', tr3.status === 201, tr3.body);
  check('la nouvelle livraison est attendue chez le destinataire', (await call('GET', '/deliveries', { token: A2, org: c2.body.id })).body.some((x) => x.status === 'arrived'));
  { const z = await call('POST', `/deliveries/${d2[0].id}/settle`, { token: A2, org: c2.body.id, body: { unit_price: 1 } }); check('le règlement d\'un chargement refoulé est impossible', z.status >= 400 && z.status < 500, z); }
  console.log(`${ok} contrôles réussis, ${ko} en échec`); process.exit(ko ? 1 : 0);
})();
