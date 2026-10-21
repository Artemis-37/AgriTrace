// Test de bout en bout : cartographie avancée (chevauchements, doublons, remplacement, imports/exports des 5 formats, simulation, quarantaine).
const crypto = require('crypto');
const JSZip = require('jszip');
const API = process.env.API || 'http://localhost:3000/v1';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;
async function call(method, path, { token, org, body, form, raw } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  let payload;
  if (body) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  if (form) payload = form;
  const res = await fetch(API + path, { method, headers, body: payload });
  if (raw) return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const check = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓', name); } else { ko++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : ''); } };
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;
const sq = (lon, lat, s = 0.0009) => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + s, lat], [lon + s, lat + s], [lon, lat + s], [lon, lat]]] });
const bowtie = { type: 'Polygon', coordinates: [[[-5, 6], [-4.999, 6.001], [-4.999, 6], [-5, 6.001], [-5, 6]]] };
const pw = 'MotDePasseSolide2026!';
let adm;
const J = (t, o) => ({ token: t, org: o.id });

async function mkOrg(tag, nProducers = 3) {
  const org = (await call('POST', '/organizations', { token: adm, body: { code: tag + run, name: tag + run } })).body;
  const mail = `${tag.toLowerCase()}.${run}@t.test`;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: mail, password: pw } });
  const t = await login(mail, pw);
  const vc = (await call('POST', '/value-chains', { ...J(t, org), body: { code: 'CACAO', name: 'Cacao' } })).body;
  const prods = [];
  for (let i = 0; i < nProducers; i++)
    prods.push((await call('POST', '/producers', { ...J(t, org), body: { last_name: 'NOM' + i, first_names: 'Prenom' + i, village: 'Hiré', section: 'S' + (i % 2), region: 'Gôh', value_chain_ids: [vc.id] } })).body.producer);
  return { org, t, vc, prods };
}
const upload = (t, org, name, buf, mode, options, wait = true) => {
  const form = new FormData();
  form.append('file', new Blob([buf]), name); form.append('mode', mode); if (options) form.append('options', JSON.stringify(options));
  return call('POST', `/geo/imports${wait ? '?wait=true' : ''}`, { token: t, org: org.id, form });
};
const gj = (features) => Buffer.from(JSON.stringify({ type: 'FeatureCollection', features }));
const feat = (props, geometry) => ({ type: 'Feature', properties: props, geometry });

(async () => {
  adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  console.log('Mise en place');
  const A = await mkOrg('GA'), B = await mkOrg('GB');
  const [a1, a2, a3] = A.prods;
  const mk = (X, prod, geometry, extra = {}) => call('POST', '/parcels', { ...J(X.t, X.org), body: { idempotency_key: key('p'), producer_id: prod.id, value_chain_id: X.vc.id, declared_area_ha: '1', geometry, confirm_not_duplicate: true, ...extra } });
  check('mise en place', !!(A.org.id && B.org.id && a1.id && a3.id && a1.internal_code));

  console.log('Paramètres et validité des géométries');
  const st = (await call('GET', '/geo/settings', J(A.t, A.org))).body;
  check('paramètres par défaut : 25 m², 1 %, IoU 0,95, blocage', st.overlap_min_m2 === 25 && st.overlap_policy === 'block' && st.near_duplicate_iou === 0.95, st);
  check('polygone « papillon » refusé à la création', (await mk(A, a1, bowtie)).status === 400);
  const noPoly = await call('POST', '/parcels', { ...J(A.t, A.org), body: { idempotency_key: key('p'), producer_id: a1.id, value_chain_id: A.vc.id, declared_area_ha: '2', latitude: 7.2, longitude: -5.2 } });
  check('point GPS seul : superficie mesurée non calculée', noPoly.status === 201 && noPoly.body.geometry_area_ha === null && noPoly.body.geometry === null, noPoly.body);

  console.log('Chevauchements et doublons à la création');
  const P1 = await mk(A, a1, sq(-6, 6.8));
  check('première parcelle sans anomalie', P1.status === 201 && P1.body.anomalies.length === 0, P1.body);
  const P2 = await mk(A, a2, sq(-5.9995, 6.8));
  check('chevauchement partiel entre producteurs : anomalie bloquante détectée', P2.status === 201 && P2.body.anomalies[0]?.kind === 'overlap_partial' && P2.body.anomalies[0].blocking === true, P2.body.anomalies);
  const an = (await call('GET', `/geo/anomalies?parcel_id=${P2.body.id}`, J(A.t, A.org))).body;
  check('anomalie : codes, producteurs, surface et pourcentages', an.length === 1 && an[0].intersection_m2 > 4000 && an[0].pct_a > 40 && an[0].pct_b > 40 && an[0].producer_a_code && an[0].producer_b_code && an[0].recommended_action && an[0].status === 'open', an[0]);
  const ctl = await call('POST', `/parcels/${P2.body.id}/control`, { ...J(A.t, A.org), body: {} });
  check('contrôle de la parcelle en anomalie bloqué', ctl.status === 422 && /anomalie/i.test(JSON.stringify(ctl.body)), ctl.body);
  const still = await call('POST', `/geo/anomalies/${an[0].id}/resolve`, { ...J(A.t, A.org), body: { resolution: 'corrected', note: 'corrigé' } });
  check('« corrigé » refusé tant que le chevauchement existe', still.status === 409, still.body);
  const fixed = await call('POST', `/parcels/${P2.body.id}/update`, { ...J(A.t, A.org), body: { geometry: sq(-5.998, 6.8), reason: 'Nouveau relevé GPS' } });
  check('correction du tracé acceptée', fixed.status === 201, fixed.body);
  const an2 = (await call('GET', `/geo/anomalies?parcel_id=${P2.body.id}&status=open`, J(A.t, A.org))).body;
  check('anomalie réévaluée : plus aucune ouverte', an2.length === 0, an2);
  const det = (await call('GET', `/parcels/${P2.body.id}`, J(A.t, A.org))).body;
  const upd = (det.history ?? []).find((h) => h.event === 'updated' && h.details?.old);
  check('historique : ancienne et nouvelle géométrie, surfaces, motif', !!upd && upd.details.old.geometry && upd.details.new.geometry && upd.details.reason === 'Nouveau relevé GPS' && upd.details.old.geometry_area_ha !== undefined, upd);
  check('contrôle possible après correction', (await call('POST', `/parcels/${P2.body.id}/control`, { ...J(A.t, A.org), body: {} })).status === 201);

  const adj = await mk(A, a3, sq(-6 + 0.0009 * 3, 6.8));   // à distance
  const adj2 = await mk(A, a3, sq(-6 - 0.0009, 6.8));      // limite commune avec P1
  check('limite commune sans surface : aucune anomalie', adj2.status === 201 && adj2.body.anomalies.length === 0, adj2.body.anomalies);
  const inc = await mk(A, a3, sq(-5.9997, 6.8002, 0.0003));
  check('parcelle incluse dans une autre : overlap_inclusion', inc.body.anomalies.some((x) => x.kind === 'overlap_inclusion'), inc.body.anomalies);
  const dupI = await mk(A, a3, sq(-6, 6.8));
  check('même tracé pour un autre producteur : doublon identique bloquant', dupI.body.anomalies.some((x) => x.kind === 'duplicate_identical' && x.blocking), dupI.body.anomalies);
  const dupSame = await mk(A, a1, sq(-6, 6.8));
  check('même tracé, même producteur → 409', dupSame.status === 409, dupSame.body);
  const dupN = await mk(A, a3, sq(-6 + 0.00001, 6.8));
  check('tracé presque identique : duplicate_near', dupN.body.anomalies.some((x) => x.kind === 'duplicate_near'), dupN.body.anomalies);

  console.log('Politique « avertir » et exceptions motivées');
  const lim = await call('POST', '/roles', { ...J(A.t, A.org), body: { code: 'cartographe', name: 'Cartographe', permissions: ['parcels:read', 'geo:anomalies', 'geo:export'] } });
  const cu = (await call('POST', '/users', { ...J(A.t, A.org), body: { email: `cart.${run}@t.test`, full_name: 'Cartographe', password: pw, role_id: lim.body.id } })).body;
  const tcart = await login(`cart.${run}@t.test`, pw);
  const a0 = (await call('GET', `/geo/anomalies?parcel_id=${dupI.body.id}&status=open&kind=duplicate_identical`, J(A.t, A.org))).body;
  check('exception sans permission geo:override → 422', (await call('POST', `/geo/anomalies/${a0[0].id}/resolve`, { ...J(tcart, A.org), body: { resolution: 'exception', note: 'accord' } })).status === 422);
  check('exception sans motif → 400', (await call('POST', `/geo/anomalies/${a0[0].id}/resolve`, { ...J(A.t, A.org), body: { resolution: 'exception', note: '' } })).status === 400);
  const ex = await call('POST', `/geo/anomalies/${a0[0].id}/resolve`, { ...J(A.t, A.org), body: { resolution: 'exception', note: 'Deux parcelles contiguës mal tracées, vérifiées sur le terrain' } });
  check('exception motivée enregistrée', ex.status === 201 && ex.body.status === 'exception' && ex.body.resolved_by, ex.body);
  const per = await call('POST', '/geo/checks/run', J(A.t, A.org));
  check('contrôle périodique : rapport chiffré', per.status === 201 && per.body.parcels_examined >= 6 && per.body.candidate_pairs >= 1 && typeof per.body.open_anomalies === 'number', per.body);
  const re = (await call('GET', `/geo/anomalies?parcel_id=${dupI.body.id}&kind=duplicate_identical`, J(A.t, A.org))).body;
  check('l\'exception accordée n\'est pas rouverte par le contrôle périodique', re.length === 1 && re[0].status === 'exception', re);
  const per2 = await call('POST', '/geo/checks/run', J(A.t, A.org));
  check('2e contrôle : aucune nouvelle anomalie (pas de répétition)', per2.body.new_anomalies === 0, per2.body);
  await call('PUT', '/geo/settings', { ...J(A.t, A.org), body: { overlap_min_m2: 25, overlap_min_pct: 1, near_duplicate_iou: 0.95, overlap_policy: 'warn' } });
  const w = await mk(A, a2, sq(-6.0995, 6.9));
  const w2 = await mk(A, a3, sq(-6.0991, 6.9));
  check('politique « warn » : chevauchement signalé mais non bloquant', w2.body.anomalies[0]?.kind === 'overlap_partial' && w2.body.anomalies[0].blocking === false, w2.body.anomalies);
  await call('PUT', '/geo/settings', { ...J(A.t, A.org), body: { overlap_min_m2: 25, overlap_min_pct: 1, near_duplicate_iou: 0.95, overlap_policy: 'block' } });
  const tiny = await mk(A, a1, sq(-6.0995 + 0.00088, 6.9 - 0.0005, 0.0005));
  check('seuil de surface : petit recouvrement mesuré mais sous tolérance configurable', tiny.status === 201);

  console.log('Remplacement contrôlé d\'un doublon');
  const m1 = await mk(A, a2, sq(-5.8, 6.8)), m2 = await mk(A, a2, sq(-5.8 + 0.00002, 6.8));
  check('doublon presque identique, même producteur', m2.body.anomalies.some((x) => x.kind === 'duplicate_near'), m2.body.anomalies);
  const mixP = await call('POST', '/geo/merges', { ...J(A.t, A.org), body: { keep_id: m1.body.id, replace_id: dupI.body.id, reason: 'test contradiction', confirm: true } });
  check('producteurs différents : fusion refusée (vérification manuelle)', mixP.status === 409 && mixP.body.contradictions?.length >= 1, mixP.body);
  const prev = await call('POST', '/geo/merges', { ...J(A.t, A.org), body: { keep_id: m1.body.id, replace_id: m2.body.id, reason: 'Même terrain relevé deux fois' } });
  check('prévisualisation sans modification', prev.status === 201 && prev.body.confirmed === false && prev.body.keep.code && prev.body.replace.code, prev.body);
  check('la parcelle à remplacer est toujours active', (await call('GET', `/parcels/${m2.body.id}`, J(A.t, A.org))).body.status === 'active');
  check('remplacement sans permission → 403', (await call('POST', '/geo/merges', { ...J(tcart, A.org), body: { keep_id: m1.body.id, replace_id: m2.body.id, reason: 'x y z', confirm: true } })).status === 403);
  const mg = await call('POST', '/geo/merges', { ...J(A.t, A.org), body: { keep_id: m1.body.id, replace_id: m2.body.id, reason: 'Même terrain relevé deux fois', confirm: true } });
  check('remplacement confirmé', mg.status === 201 && mg.body.confirmed === true, mg.body);
  const old = (await call('GET', `/parcels/${m2.body.id}`, J(A.t, A.org))).body;
  check('ancien enregistrement archivé (pas supprimé), lié à la parcelle conservée, historique conservé', old.status === 'archived' && old.merged_into === m1.body.id && old.history.some((h) => h.event === 'merged') && old.history.some((h) => h.event === 'created'), old);
  const keptH = (await call('GET', `/parcels/${m1.body.id}`, J(A.t, A.org))).body;
  check('historique de la parcelle conservée : événement de remplacement', keptH.history.some((h) => h.event === 'merged'));
  check('les anomalies du doublon sont refermées', (await call('GET', `/geo/anomalies?parcel_id=${m2.body.id}&status=open`, J(A.t, A.org))).body.length === 0);
  check('remplacer deux fois → 400', (await call('POST', '/geo/merges', { ...J(A.t, A.org), body: { keep_id: m1.body.id, replace_id: m2.body.id, reason: 'again', confirm: true } })).status === 400);
  const next = await mk(A, a2, sq(-5.5, 6.7));
  const codes = [m1.body.code, m2.body.code];
  check('un code archivé n\'est jamais réattribué', !codes.includes(next.body.code) && next.body.code.startsWith(a2.internal_code), [next.body.code, codes]);

  console.log('Importation en masse : simulation, confirmation, réimportation');
  const f1 = feat({ producer_code: b1code(), parcel_code: '', filiere: 'Cacao', declared_area_ha: '3,5', external_id: 'EXT-1' }, sq(-4, 6.5, 0.003));
  function b1code() { return B.prods[0].internal_code; }
  const file = gj([
    f1,
    feat({ producer_code: B.prods[1].internal_code, filiere: 'cacao', declared_area_ha: '2.1', external_id: 'EXT-2' }, sq(-3.9, 6.5, 0.002)),
    feat({ producer_code: 'ZZZ999', filiere: 'Cacao', declared_area_ha: '1' }, sq(-3.8, 6.5)),
    feat({ producer_code: B.prods[2].internal_code, filiere: 'Cacao', declared_area_ha: '1' }, bowtie),
    feat({ producer_code: B.prods[2].internal_code, filiere: 'Cacao', declared_area_ha: '1' }, { type: 'Point', coordinates: [-3, 6] }),
    feat({ producer_code: B.prods[1].internal_code, filiere: 'Cacao', declared_area_ha: '2.1' }, sq(-3.9, 6.5, 0.002)),     // doublon dans le fichier
    feat({ producer_code: B.prods[2].internal_code, filiere: 'Cacao', declared_area_ha: '1' }, sq(-3.7, 6.5)),
    feat({ producer_code: B.prods[2].internal_code, filiere: 'Cacao' }, sq(-3.5, 6.5)),                                      // surface déclarée manquante
  ]);
  const cnt = async (X) => (await call('GET', '/parcels', J(X.t, X.org))).body.length;
  const before = await cnt(B);
  const noCol = await upload(B.t, B.org, 'x.geojson', gj([feat({ name: 'PROD', foo: 1 }, sq(-3, 6))]), 'simulate');
  check('colonne du code producteur non devinée à partir du nom du polygone → 400', noCol.status === 400 && /code producteur/.test(JSON.stringify(noCol.body)), noCol.body);
  const sim = await upload(B.t, B.org, 'parcelles.geojson', file, 'simulate');
  const r = sim.body.report ?? {};
  check('simulation : statut et rapport', sim.status === 201 && sim.body.status === 'simulated' && r.examined === 8, sim.body);
  check('rapport : 3 créables (dont 1 mise à jour impossible), producteur inconnu, géométries invalides, doublon', r.creatable === 3 && r.unknown_producers === 1 && r.invalid_geometries === 2 && r.rejected === 5 && r.duplicates_confirmed >= 1, r);
  check('rapport : liste détaillée des anomalies avec motifs', r.anomalies?.some((x) => /producteur_inconnu/.test(x.reasons.join())) && r.anomalies?.some((x) => /surface_déclarée_manquante/.test(x.reasons.join())) && r.anomalies?.some((x) => /doublon_dans_le_fichier/.test(x.reasons.join())), r.anomalies);
  check('la simulation ne crée aucune parcelle', (await cnt(B)) === before);
  const conf = await call('POST', `/geo/imports/${sim.body.id}/confirm?wait=true`, { ...J(B.t, B.org), body: { mode: 'create_update' } });
  check('confirmation : parcelles créées', conf.status === 201 && conf.body.status === 'completed' && conf.body.report.creatable === 3, conf.body);
  const afterC = (await call('GET', '/parcels', J(B.t, B.org))).body;
  check('3 parcelles créées, rattachées aux bons producteurs, codes serveur', afterC.length === before + 3 && afterC.every((p) => /-P\d+$/.test(p.code)) && afterC.some((p) => p.producer_id === B.prods[0].id && Number(p.declared_area_ha) === 3.5), afterC);
  check('on ne peut pas confirmer deux fois', (await call('POST', `/geo/imports/${sim.body.id}/confirm`, { ...J(B.t, B.org), body: { mode: 'create_update' } })).status === 409);
  const again = await upload(B.t, B.org, 'parcelles.geojson', file, 'create_update');
  check('réimportation du même fichier : aucune nouvelle parcelle', again.body.report.creatable === 0 && again.body.report.unchanged === 3 && (await cnt(B)) === before + 3, again.body.report);
  const items = (await call('GET', `/geo/imports/${again.body.id}/items?outcome=unchanged`, J(B.t, B.org))).body;
  check('lignes inchangées reliées aux parcelles existantes', items.length === 3 && items.every((i) => i.parcel_id));
  const auditImp = (await call('GET', '/audit-logs?limit=100', J(B.t, B.org))).body;
  check('journal d\'audit : imports tracés (fichier, empreinte)', JSON.stringify(auditImp).includes('geo.import.start') && JSON.stringify(auditImp).includes('sha256'));
  const updFile = gj([feat({ producer_code: B.prods[0].internal_code, filiere: 'Cacao', declared_area_ha: '4', external_id: 'EXT-1' }, sq(-4, 6.5, 0.003))]);
  const co = await upload(B.t, B.org, 'maj.geojson', updFile, 'create_only');
  check('mode création uniquement : parcelle existante rejetée', co.body.report.rejected === 1 && /existe_déjà/.test(co.body.report.anomalies[0].reasons.join()), co.body.report);
  const cu2 = await upload(B.t, B.org, 'maj.geojson', updFile, 'create_update');
  check('mode mise à jour contrôlée : surface déclarée modifiée, historique conservé', cu2.body.report.updatable === 1, cu2.body.report);
  const p0 = afterC.find((p) => p.producer_id === B.prods[0].id);
  const p0d = (await call('GET', `/parcels/${p0.id}`, J(B.t, B.org))).body;
  check('mise à jour : déclarée distincte de la mesurée', Number(p0d.declared_area_ha) === 4 && Number(p0d.geometry_area_ha) > 8 && p0d.history.some((h) => h.details?.import_id), p0d);

  console.log('Quarantaine et tout-ou-rien');
  const ovl = gj([
    feat({ producer_code: B.prods[0].internal_code, filiere: 'Cacao', declared_area_ha: '1' }, sq(-3.1, 6.2)),
    feat({ producer_code: B.prods[1].internal_code, filiere: 'Cacao', declared_area_ha: '1' }, sq(-4 + 0.0015, 6.5 + 0.0005, 0.002)),   // chevauche une parcelle importée
  ]);
  const q = await upload(B.t, B.org, 'q.geojson', ovl, 'quarantine');
  check('quarantaine : l\'objet en anomalie est isolé, l\'autre est créé', q.body.report.creatable === 1 && q.body.report.pending_correction === 1 && q.body.report.overlaps >= 1, q.body.report);
  const qf = await call('GET', `/geo/imports/${q.body.id}/quarantine.geojson`, J(B.t, B.org));
  check('fichier de quarantaine avec les motifs', qf.body.features?.length === 1 && /overlap/.test(qf.body.features[0].properties._reasons), qf.body);
  const n2 = await cnt(B);
  const aon = await upload(B.t, B.org, 'a.geojson', gj([feat({ producer_code: B.prods[0].internal_code, declared_area_ha: '1', filiere: 'Cacao' }, sq(-3.0, 6.0)), feat({ producer_code: 'INCONNU', declared_area_ha: '1', filiere: 'Cacao' }, sq(-2.9, 6.0))]), 'create_update', { all_or_nothing: true });
  check('tout-ou-rien : une ligne en anomalie → rien n\'est écrit', aon.body.status === 'failed' && /tout ou rien/i.test(aon.body.error) && (await cnt(B)) === n2, aon.body);
  const running = await upload(B.t, B.org, 'bg.geojson', gj([feat({ producer_code: B.prods[0].internal_code, declared_area_ha: '1', filiere: 'Cacao' }, sq(-2.0, 6.0))]), 'simulate', null, false);
  check('traitement en arrière-plan : réponse immédiate avec identifiant', running.status === 201 && running.body.id && ['running', 'simulated'].includes(running.body.status), running.body);
  let fin; for (let i = 0; i < 30; i++) { fin = (await call('GET', `/geo/imports/${running.body.id}`, J(B.t, B.org))).body; if (fin.status !== 'running') break; await new Promise((r) => setTimeout(r, 200)); }
  check('état de progression consultable jusqu\'à la fin', fin.status === 'simulated' && fin.progress === fin.total, fin);

  // UTM 30N (EPSG:32630) : ce point vaut environ (-5.7500, 6.8500) ; le carré de 100 m × 100 m est converti puis traité comme n'importe quelle parcelle
  const utmFile = Buffer.from(JSON.stringify({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::32630' } },
    features: [feat({ producer_code: B.prods[0].internal_code, declared_area_ha: '1', filiere: 'Cacao' }, { type: 'Polygon', coordinates: [[[196049.55, 758037.44], [196149.55, 758037.44], [196149.55, 758137.44], [196049.55, 758137.44], [196049.55, 758037.44]]] })] }));
  const utmRes = await upload(B.t, B.org, 'utm.geojson', utmFile, 'simulate');
  check('UTM 30N : converti en WGS84 et signalé', utmRes.status === 201 && utmRes.body.report?.creatable === 1 && /UTM 30N.*converties en WGS84/.test((utmRes.body.warnings ?? []).join(' ')), utmRes.body);
  const lambert = Buffer.from(JSON.stringify({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'EPSG:2154' } }, features: [] }));
  check('Lambert 93 : refusé (422)', (await upload(B.t, B.org, 'l.geojson', lambert, 'simulate')).status === 422);

  console.log('Fichiers refusés');
  check('extension non conforme au contenu → 422', (await upload(B.t, B.org, 'x.kml', file, 'simulate')).status === 422);
  check('archive corrompue → 422', (await upload(B.t, B.org, 'x.zip', Buffer.from('PK\x03\x04garbage'), 'simulate')).status === 422);
  check('fichier sans objet → 422', (await upload(B.t, B.org, 'x.geojson', gj([]), 'simulate', { producer_field: 'p' })).status === 422);
  check('autre système de coordonnées → 422', (await upload(B.t, B.org, 'x.geojson', Buffer.from(JSON.stringify({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'EPSG:32630' } }, features: [] })), 'simulate')).status === 422);
  const utm = gj([feat({ producer_code: B.prods[0].internal_code, declared_area_ha: '1', filiere: 'Cacao' }, { type: 'Polygon', coordinates: [[[500000, 700000], [500100, 700000], [500100, 700100], [500000, 700100], [500000, 700000]]] })]);
  const u = await upload(B.t, B.org, 'utm.geojson', utm, 'simulate');
  check('coordonnées projetées détectées comme invalides', u.body.report?.invalid_geometries === 1, u.body.report);
  check('import sans permission → 403', (await upload(tcart, A.org, 'x.geojson', file, 'simulate')).status === 403);

  console.log('Carte du portail');
  const mp = await call('GET', '/geo/map', J(B.t, B.org));
  check('carte : collection de polygones sans donnée personnelle', mp.status === 200 && mp.body.type === 'FeatureCollection' && mp.body.features.length >= 3 && !JSON.stringify(mp.body).includes('phone') && !('producer_name' in mp.body.features[0].properties), mp.body);
  check('carte : propriétés minimales (code, statut, anomalie)', ['id', 'code', 'producer_code', 'validation_status', 'anomaly'].every((k) => k in mp.body.features[0].properties));
  check('carte : filtre bbox vide hors zone', (await call('GET', '/geo/map?bbox=100,50,101,51', J(B.t, B.org))).body.features.length === 0);
  check('carte : bbox invalide → 400', (await call('GET', '/geo/map?bbox=a,b', J(B.t, B.org))).status === 400);
  check('carte : autre coopérative isolée', (await call('GET', '/geo/map', J(A.t, A.org))).body.features.every((f) => !mp.body.features.some((g) => g.properties.id === f.properties.id)));

  console.log('Exportation et réimportation des cinq formats');
  const fmts = [['geojson', 'geojson'], ['kml', 'kml'], ['kmz', 'kmz'], ['shapefile', 'zip'], ['gpkg', 'gpkg']];
  const src = (await call('GET', '/geo/export?format=geojson', J(B.t, B.org)));
  const srcFc = JSON.parse(Buffer.from(JSON.stringify(src.body)).toString());
  check('GeoJSON : champs minimaux présents', srcFc.features.length >= 3 && ['parcel_id', 'parcel_code', 'producer_code', 'cooperative_code', 'filiere', 'declared_area_ha', 'measured_area_ha', 'centroid_longitude', 'centroid_latitude', 'geometry_status', 'validation_status', 'survey_date', 'last_updated', 'campaign_code'].every((k) => k in srcFc.features[0].properties), srcFc.features[0]?.properties);
  check('export : nom du producteur et téléphone absents par défaut', !('producer_name' in srcFc.features[0].properties) && !JSON.stringify(srcFc).includes('phone'));
  for (const [fmt, ext] of fmts) {
    const ex = await call('GET', `/geo/export?format=${fmt}`, { ...J(B.t, B.org), raw: true });
    check(`${fmt} : export reçu`, ex.status === 200 && ex.buf.length > 200 && /attachment/.test(ex.headers.get('content-disposition') || ''), ex.status);
    const T = await mkOrg('F' + fmt.slice(0, 4).toUpperCase(), 3);   // coopérative cible avec les mêmes codes producteurs
    const si = await upload(T.t, T.org, `export.${ext}`, ex.buf, 'simulate', { producer_field: fmt === 'shapefile' ? 'prod_code' : 'producer_code', declared_area_field: fmt === 'shapefile' ? 'decl_ha' : 'declared_area_ha', value_chain_field: 'filiere', ignore_parcel_code: true });
    check(`${fmt} : réimport simulé sans rejet, producteurs reconnus`, si.status === 201 && si.body.report?.examined === srcFc.features.length && si.body.report.rejected === 0 && si.body.report.unknown_producers === 0, si.body.report ?? si.body);
    const cf = await call('POST', `/geo/imports/${si.body.id}/confirm?wait=true`, { ...J(T.t, T.org), body: { mode: 'create_only' } });
    const back = (await call('GET', '/geo/export?format=geojson', J(T.t, T.org))).body;
    const key2 = (p) => p.producer_code + '|' + Number(p.declared_area_ha).toFixed(3);
    const A1 = new Map(srcFc.features.map((f) => [key2(f.properties), f])), B1 = new Map(back.features.map((f) => [key2(f.properties), f]));
    let same = A1.size === B1.size && cf.body.status === 'completed';
    for (const [k, f] of A1) { const g = B1.get(k); if (!g) { same = false; break; } const x = f.geometry.coordinates[0], y = g.geometry.coordinates[0]; const nx = x.length; if (nx !== y.length) { same = false; break; } for (let i = 0; i < nx; i++) if (Math.abs(x[i][0] - y[i][0]) > 1e-6 || Math.abs(x[i][1] - y[i][1]) > 1e-6) same = false; }
    check(`${fmt} : coordonnées, surfaces et rattachement au bon producteur identiques après aller-retour`, same, { a: [...A1.keys()], b: [...B1.keys()], status: cf.body.status });
  }

  console.log('Contrôle des exports et séparation des coopératives');
  const exNames = await call('GET', '/geo/export?format=geojson&include_names=true', J(B.t, B.org));
  check('nom des producteurs inclus sur demande avec permission', exNames.body.features[0].properties.producer_name, exNames.body.features[0].properties);
  check('nom des producteurs sans permission dédiée → 422', (await call('GET', '/geo/export?format=geojson&include_names=true', J(tcart, A.org))).status === 422);
  check('champ sensible (téléphone) non exportable → 400', (await call('GET', '/geo/export?format=geojson&fields=phone', J(B.t, B.org))).status === 400);
  const fl = await call('GET', `/geo/export?format=geojson&producer_id=${B.prods[0].id}&fields=section,village,agent`, J(B.t, B.org));
  check('filtres (producteur) et champs supplémentaires', fl.body.features.length >= 1 && fl.body.features.every((f) => f.properties.producer_code === B.prods[0].internal_code && 'section' in f.properties && 'agent' in f.properties), fl.body.features.length);
  const bb = await call('GET', '/geo/export?format=geojson&bbox=-4.1,6.4,-3.9,6.6', J(B.t, B.org));
  check('filtre par zone géographique (bbox)', bb.body.features.length >= 1 && bb.body.features.length < srcFc.features.length, bb.body.features.length);
  check('export : coopérative A ne voit pas B', (await call('GET', '/geo/export?format=geojson', J(A.t, A.org))).body.features.every((f) => !srcFc.features.some((g) => g.properties.parcel_id === f.properties.parcel_id)));
  check('anomalies de A invisibles depuis B', (await call('GET', '/geo/anomalies', J(B.t, B.org))).body.every((x) => !x.parcel_a_id || ![P1.body.id, P2.body.id].includes(x.parcel_a_id)));
  check('import d\'une autre coopérative inaccessible → 404', (await call('GET', `/geo/imports/${sim.body.id}`, J(A.t, A.org))).status === 404);
  check('en-tête organisation d\'une autre coopérative refusé', [403, 404].includes((await call('GET', '/geo/anomalies', { token: B.t, org: A.org.id })).status));
  const audX = (await call('GET', '/audit-logs?limit=100', J(B.t, B.org))).body;
  check('exports tracés dans le journal d\'audit', JSON.stringify(audX).includes('geo.export'));

  console.log(`\n${ok} contrôles réussis, ${ko} en échec`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
