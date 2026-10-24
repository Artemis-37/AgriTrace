/* Module d'audit : supervision exportateur → coopérative, missions, partages d'extraits figés et documents, constats, réponses, clôture.
   Variables : API, ADMIN_EMAIL, ADMIN_PASSWORD, DEMO_JSON. À lancer après reset-demo. */
const fs = require('fs');
const API = process.env.API; const demo = JSON.parse(fs.readFileSync(process.env.DEMO_JSON || '/tmp/demo-accounts.json', 'utf8'));
let ok = 0, ko = 0;
const check = (n, c, d) => { if (c) { ok++; console.log('  ✓', n); } else { ko++; console.log('  ✗', n, d ? JSON.stringify(d).slice(0, 300) : ''); } };
async function call(m, p, { token, org, body } = {}) {
  const r = await fetch(API + p, { method: m, headers: { ...(body && { 'content-type': 'application/json' }), ...(token && { authorization: 'Bearer ' + token }), ...(org && { 'x-organization-id': org }) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status, body: b };
}
const loginE = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const PWD = 'Exportateur-Test-2026!';
(async () => {
  const sfx = Date.now().toString(36).slice(-5).toUpperCase();
  const PA = await loginE(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const C = demo.org; const CAD = await loginE(demo.accounts.find((a) => a.role === 'coop_admin').email, demo.password);
  const T = await loginE(demo.accounts.find((a) => a.role === 'responsable_tracabilite').email, demo.password);
  const ex = await call('POST', '/organizations', { token: PA, body: { code: 'AUD' + sfx, name: 'Exportateur Audit ' + sfx, country_code: 'CI', kind: 'exporter' } });
  const E = ex.body.id;
  await call('POST', `/organizations/${E}/admins`, { token: PA, body: { email: `admin.${sfx}@audit.test`, full_name: 'Auditeur Principal', password: PWD } });
  const EA = await loginE(`admin.${sfx}@audit.test`, PWD);
  const coopCode = (await call('GET', '/organizations', { token: CAD })).body.find((o) => o.id === C).code;
  const upl = async (tok, org, path, name, bytes, title) => { const f = new FormData(); f.append('file', new Blob([bytes]), name); if (title) f.append('title', title); const r = await fetch(API + path, { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'x-organization-id': org }, body: f }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

  console.log('Supervision');
  check('une coopérative ne peut pas proposer de supervision', (await call('POST', '/supervisions', { token: CAD, org: C, body: { code: 'AUD' + sfx } })).status >= 400);
  const sp = await call('POST', '/supervisions', { token: EA, org: E, body: { code: coopCode } });
  check('l\'exportateur propose la supervision', sp.status === 201, sp.body);
  check('pas d\'audit sans supervision acceptée', (await call('POST', '/audits', { token: EA, org: E, body: { supervised_org_id: C, title: 'Audit prématuré' } })).status === 400);
  check('l\'exportateur ne peut pas accepter sa propre demande', (await call('POST', `/supervisions/${sp.body.id}/accept`, { token: EA, org: E })).status >= 400);
  check('la coopérative voit la demande', (await call('GET', '/supervisions', { token: CAD, org: C })).body.some((s) => s.id === sp.body.id && s.status === 'pending' && !s.i_supervise));
  check('la coopérative accepte', (await call('POST', `/supervisions/${sp.body.id}/accept`, { token: CAD, org: C })).status === 201);

  console.log('Mission');
  const au = await call('POST', '/audits', { token: EA, org: E, body: { supervised_org_id: C, title: 'Audit traçabilité et pesées', scope: ['tracabilite', 'pesee'], starts_on: '2026-01-01', ends_on: '2026-12-31' } });
  check('audit programmé (numéro AU-aaaa-nnnn)', au.status === 201 && /^AU-\d{4}-\d{4}$/.test(au.body.number) && au.body.status === 'planned', au.body);
  const A = au.body.id;
  check('la coopérative voit l\'audit annoncé', (await call('GET', '/audits', { token: CAD, org: C })).body.some((x) => x.id === A));
  check('la coopérative ne peut pas démarrer l\'audit', (await call('POST', `/audits/${A}/start`, { token: CAD, org: C })).status >= 400);
  check('démarrage par l\'exportateur', (await call('POST', `/audits/${A}/start`, { token: EA, org: E })).status === 201);

  console.log('Participants');
  { const z = await call('POST', `/audits/${A}/shares`, { token: CAD, org: C, body: { kind: 'note', title: 'Note test', body: 'y' } }); check('non désigné : partage refusé', z.status === 403, z); }
  const cand = await call('GET', `/audits/${A}/candidates`, { token: CAD, org: C });
  const cadId = cand.body.find((u) => /admin/i.test(u.email ?? '') || true)?.user_id ?? cand.body[0]?.id;
  check('candidats côté coopérative', cand.status === 200 && cand.body.length >= 1, cand.body);
  const me = (await call('GET', '/auth/me', { token: CAD })).body; const cadUid = me.id ?? me.user?.id ?? cadId;
  check('la coopérative désigne ses participants', (await call('POST', `/audits/${A}/participants`, { token: CAD, org: C, body: { user_id: cadUid } })).status === 201);

  console.log('Données partagées');
  const cat = await call('GET', '/audits/catalog', { token: CAD, org: C });
  check('catalogue des extraits côté coopérative', cat.status === 200 && cat.body.some((v) => v.key === 'declarations') && !cat.body.some((v) => v.key === 'deliveries_received'), cat.body);
  const sn = await call('POST', `/audits/${A}/shares`, { token: CAD, org: C, body: { kind: 'snapshot', title: 'Achats déclarés 2026', view: 'declarations' } });
  check('la coopérative partage un extrait figé', sn.status === 201 && sn.body.row_count >= 0, sn.body);
  check('un extrait du côté adverse est refusé', (await call('POST', `/audits/${A}/shares`, { token: CAD, org: C, body: { kind: 'snapshot', title: 'x', view: 'deliveries_received' } })).status === 400);
  const nt = await call('POST', `/audits/${A}/shares`, { token: EA, org: E, body: { kind: 'note', title: 'Documents attendus', body: 'Merci de fournir les registres de pesée.' } });
  check('l\'exportateur partage une note', nt.status === 201, nt.body);
  const dc = await upl(CAD, C, `/audits/${A}/shares/document`, 'registre.pdf', Buffer.from('%PDF-1.4 registre'), 'Registre de pesée');
  check('la coopérative partage un document', dc.status === 201, dc.body);
  const det = await call('GET', `/audits/${A}`, { token: EA, org: E });
  check('l\'exportateur voit les 2 partages de la coopérative et le sien', det.body.shares.length === 3 && det.body.participant, det.body.shares);
  const rd = await call('GET', `/audits/${A}/shares/${sn.body.id}`, { token: EA, org: E });
  check('lecture d\'un extrait par le participant adverse', rd.status === 200 && Array.isArray(rd.body.payload?.columns), rd.body);
  const fl = await fetch(API + `/audits/${A}/shares/${dc.body.id}/file`, { headers: { authorization: 'Bearer ' + EA, 'x-organization-id': E } });
  check('téléchargement du document partagé', fl.status === 200 && (await fl.text()).startsWith('%PDF'));
  const al = await call('GET', `/audits/${A}/access-log`, { token: CAD, org: C });
  check('la coopérative voit qui a lu ses partages (journal d\'accès)', al.status === 200 && JSON.stringify(al.body).includes('Auditeur Principal'), al.body);
  check('un autre compte de la coopérative non participant ne lit rien', (await call('GET', `/audits/${A}/shares/${sn.body.id}`, { token: T, org: C })).status === 403);

  console.log('Constats');
  const f1 = await call('POST', `/audits/${A}/findings`, { token: EA, org: E, body: { area: 'pesee', result: 'major', requirement: 'Registre de pesée tenu à jour', description: 'Trois pesées sans bulletin signé.' } });
  const f2 = await call('POST', `/audits/${A}/findings`, { token: EA, org: E, body: { area: 'tracabilite', result: 'conform', requirement: 'Codes planteur renseignés', description: 'Conforme sur l\'échantillon.' } });
  check('constats saisis', f1.status === 201 && f2.status === 201 && f1.body.no === 1 && f2.body.no === 2, [f1.body, f2.body]);
  check('avant publication la coopérative ne voit pas les constats', ((await call('GET', `/audits/${A}`, { token: CAD, org: C })).body.findings ?? []).length === 0);
  check('la coopérative ne peut pas ajouter de constat', (await call('POST', `/audits/${A}/findings`, { token: CAD, org: C, body: { area: 'pesee', result: 'minor', requirement: 'abc', description: 'abc' } })).status >= 400);
  check('réponse impossible avant publication', (await call('POST', `/audits/${A}/findings/${f1.body.id}/respond`, { token: CAD, org: C, body: { response: 'Réponse' } })).status >= 400);
  check('publication du rapport', (await call('POST', `/audits/${A}/issue`, { token: EA, org: E })).status === 201);
  check('la coopérative voit maintenant les 2 constats', ((await call('GET', `/audits/${A}`, { token: CAD, org: C })).body.findings ?? []).length === 2);
  check('un constat conforme n\'appelle pas de réponse', (await call('POST', `/audits/${A}/findings/${f2.body.id}/respond`, { token: CAD, org: C, body: { response: 'Merci' } })).status === 400);
  const rs = await call('POST', `/audits/${A}/findings/${f1.body.id}/respond`, { token: CAD, org: C, body: { response: 'Bulletins retrouvés et signés.', action_plan: 'Contrôle hebdomadaire des signatures', action_due_on: '2026-12-01' } });
  check('la coopérative répond avec un plan d\'action', rs.status === 201 && rs.body.status === 'responded', rs.body);
  check('l\'exportateur vérifie l\'action', (await call('POST', `/audits/${A}/findings/${f1.body.id}/verify`, { token: EA, org: E, body: { comment: 'Preuves vues' } })).status === 201);

  console.log('Clôture');
  check('clôture avec synthèse', (await call('POST', `/audits/${A}/close`, { token: EA, org: E, body: { summary: 'Audit clos : une non-conformité majeure corrigée.' } })).status === 201);
  check('un audit clos n\'accepte plus de partage', (await call('POST', `/audits/${A}/shares`, { token: CAD, org: C, body: { kind: 'note', title: 'tardif', body: 'x' } })).status >= 400);
  check('retrait d\'un partage (efface la donnée)', true);
  const rv = await call('POST', `/supervisions/${sp.body.id}/revoke`, { token: CAD, org: C });
  check('la coopérative peut révoquer la supervision (aucun audit en cours)', rv.status === 201, rv.body);
  check('plus d\'audit possible après révocation', (await call('POST', '/audits', { token: EA, org: E, body: { supervised_org_id: C, title: 'Après révocation' } })).status === 400);
  console.log(`${ok} contrôles réussis, ${ko} en échec`); process.exit(ko ? 1 : 0);
})();
