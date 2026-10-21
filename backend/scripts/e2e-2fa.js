// Double authentification (TOTP), verrouillage par adresse, chiffrement des documents au repos, initialisation depuis le réseau.
// Lancer sur une API en NODE_ENV=production avec TRUST_PROXY=1 et DOCUMENTS_KEY (voir /tmp/up-sec.sh). Variables : API, ADMIN_EMAIL, ADMIN_PASSWORD, DOCUMENTS_DIR.
const crypto = require('crypto'); const fs = require('fs'); const path = require('path');
const { totpCode, stepAt } = require('../dist/auth/totp');
const API = process.env.API || 'http://localhost:3113/v1';
const DOCS = process.env.DOCUMENTS_DIR || '/tmp/agritrace-docs';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;
async function call(method, p, { token, org, body, ip, form } = {}) {
  const h = {}; if (token) h.authorization = `Bearer ${token}`; if (org) h['x-organization-id'] = org; if (ip) h['x-forwarded-for'] = ip;
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(API + p, { method, headers: h, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const buf = Buffer.from(await res.arrayBuffer()); let json; try { json = JSON.parse(buf.toString()); } catch { json = null; }
  return { status: res.status, body: json, raw: buf };
}
const check = (n, c, x) => { if (c) { ok++; console.log('  ✓', n); } else { ko++; console.log('  ✗', n, x !== undefined ? JSON.stringify(x).slice(0, 300) : ''); } };
const pw = 'MotDePasseSolide2026!';
const login = (email, password, otp, ip) => call('POST', '/auth/login', { body: { email, password, ...(otp ? { otp } : {}) }, ip });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, null, '10.9.9.1');
  const org = (await call('POST', '/organizations', { token: adm.body.access_token, body: { code: 'TF' + run, name: 'TF' + run } })).body;
  const mail = `tf.${run.toLowerCase()}@t.test`, mail2 = `tf2.${run.toLowerCase()}@t.test`;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm.body.access_token, body: { email: mail, full_name: 'Chef', password: pw } });
  await call('POST', `/organizations/${org.id}/admins`, { token: adm.body.access_token, body: { email: mail2, full_name: 'Chef2', password: pw } });
  const l0 = await login(mail, pw, null, '10.0.0.1'); const tok = l0.body.access_token;

  console.log('Activation');
  check('état initial : inactive', (await call('GET', '/auth/2fa', { token: tok })).body.enabled === false);
  const setup = (await call('POST', '/auth/2fa/setup', { token: tok })).body;
  check('secret et URI fournis', /^[A-Z2-7]{32}$/.test(setup.secret) && setup.otpauth_uri.startsWith('otpauth://totp/'), setup);
  check('code faux refusé à l\'activation', (await call('POST', '/auth/2fa/enable', { token: tok, body: { code: '000000' } })).status === 400);
  const en = await call('POST', '/auth/2fa/enable', { token: tok, body: { code: totpCode(setup.secret, stepAt()) } });
  check('activation avec un code valide + 8 codes de secours', en.status === 200 && en.body.recovery_codes.length === 8, en.body);
  const rec = en.body.recovery_codes;

  console.log('Connexion');
  const noOtp = await login(mail, pw, null, '10.0.0.1');
  check('sans code : 401 OTP_REQUIRED, aucun jeton', noOtp.status === 401 && noOtp.body.code === 'OTP_REQUIRED' && !noOtp.body.access_token, noOtp.body);
  const bad = await login(mail, pw, '123456', '10.0.0.1');
  check('mauvais code : 401 OTP_INVALID', bad.status === 401 && bad.body.code === 'OTP_INVALID', bad.body);
  const wrongPwOtp = await login(mail, 'Mauvais-1234-xyz', totpCode(setup.secret, stepAt()), '10.0.0.1');
  check('mauvais mot de passe : jamais d\'indication sur le second facteur', wrongPwOtp.status === 401 && wrongPwOtp.body.message === 'Identifiants invalides', wrongPwOtp.body);
  // Le pas courant est déjà consommé à l'activation : on utilise le pas suivant (tolérance d'horloge ±1).
  const next = totpCode(setup.secret, stepAt() + 1);
  const good = await login(mail, pw, next, '10.0.0.1');
  check('bon code accepté', good.status === 200 && !!good.body.access_token, good.body);
  check('le même code ne peut pas être rejoué', (await login(mail, pw, next, '10.0.0.1')).status === 401);
  const r1 = await login(mail, pw, rec[0], '10.0.0.1');
  check('code de secours accepté', r1.status === 200, r1.body);
  check('code de secours à usage unique', (await login(mail, pw, rec[0], '10.0.0.1')).status === 401);

  console.log('Désactivation et réinitialisation');
  const tok2 = r1.body.access_token;
  check('désactivation refusée sans bon code', (await call('POST', '/auth/2fa/disable', { token: tok2, body: { password: pw, code: '111111' } })).status === 401);
  check('désactivation refusée avec mauvais mot de passe', (await call('POST', '/auth/2fa/disable', { token: tok2, body: { password: 'faux-Mot-2026!', code: rec[1] } })).status === 401);
  const t2 = (await login(mail2, pw, null, '10.0.0.2')).body.access_token;
  const s2 = (await call('POST', '/auth/2fa/setup', { token: t2 })).body;
  await call('POST', '/auth/2fa/enable', { token: t2, body: { code: totpCode(s2.secret, stepAt()) } });
  const users = (await call('GET', '/users', { token: tok2, org: org.id })).body;
  const u2 = (Array.isArray(users) ? users : users.items ?? []).find((u) => u.email === mail2);
  const rst = await call('POST', `/users/${u2?.id}/reset-2fa`, { token: tok2, org: org.id });
  check('un administrateur réinitialise la 2FA d\'un collègue', rst.status === 204, rst);
  check('après réinitialisation : connexion sans code', (await login(mail2, pw, null, '10.0.0.2')).status === 200);
  const dis = await call('POST', '/auth/2fa/disable', { token: tok2, body: { password: pw, code: rec[1] } });
  check('désactivation avec mot de passe + code de secours', dis.status === 204, dis);
  const after = await login(mail, pw, null, '10.0.0.1'); check('connexion sans code après désactivation', after.status === 200, after.body);

  console.log('Verrouillage par adresse');
  const victim = `vic.${run.toLowerCase()}@t.test`;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm.body.access_token, body: { email: victim, full_name: 'Victime', password: pw } });
  for (let i = 0; i < 5; i++) await login(victim, 'Faux-mot-de-passe-1A!' + i, null, '203.0.113.7');
  check('l\'adresse de l\'attaquant est verrouillée (même avec le bon mot de passe)', (await login(victim, pw, null, '203.0.113.7')).status === 401);
  check('la victime se connecte toujours depuis son adresse', (await login(victim, pw, null, '198.51.100.20')).status === 200);

  console.log('Documents chiffrés au repos');
  const prod = (await call('POST', '/producers', { token: tok2, org: org.id, body: { last_name: 'Doc', first_names: 'T', village: 'V', section: 'S1' } })).body.producer;
  const pdf = Buffer.from('%PDF-1.4\n% contenu confidentiel ' + run + '\n%%EOF\n');
  const f = new FormData(); f.append('file', new Blob([pdf], { type: 'application/pdf' }), 'p.pdf');
  for (const [k, v] of Object.entries({ subject_type: 'producer', subject_id: prod.id, kind: 'piece_identite' })) f.append(k, v);
  const up = await call('POST', '/documents', { token: tok2, org: org.id, form: f });
  check('dépôt accepté', up.status === 201, up.body);
  const dir = path.join(DOCS, org.id);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const onDisk = files.length ? fs.readFileSync(path.join(dir, files[0])) : Buffer.alloc(0);
  check('fichier chiffré sur le disque (en-tête AGT1, contenu illisible)', onDisk.subarray(0, 4).toString() === 'AGT1' && !onDisk.includes(Buffer.from('confidentiel')));
  const dl = await call('GET', `/documents/${up.body.id}/download`, { token: tok2, org: org.id });
  check('téléchargement : contenu d\'origine restitué', dl.status === 200 && dl.raw.equals(pdf));

  console.log('Initialisation depuis le réseau');
  const bs = await fetch(API + '/bootstrap/local', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' }, body: '{}' });
  check('initialisation : refus ou erreur de validation, jamais de création sans autorisation', [400, 403].includes(bs.status), bs.status);

  if (process.env.API_REQ2FA) {
    // Serveur démarré avec REQUIRE_2FA=true : un administrateur sans 2FA est bloqué partout sauf pour l'activer.
    console.log('2FA obligatoire');
    const A2 = process.env.API_REQ2FA; const c2 = async (m, p, o = {}) => { const h = { authorization: `Bearer ${o.token}` }; if (o.org) h['x-organization-id'] = o.org; if (o.body) h['content-type'] = 'application/json'; const r = await fetch(A2 + p, { method: m, headers: h, body: o.body ? JSON.stringify(o.body) : undefined }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
    const lg = async (e, p) => (await (await fetch(A2 + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e, password: p }) })).json()).access_token;
    const org2 = (await call('POST', '/organizations', { token: adm.body.access_token, body: { code: 'RQ' + run, name: 'RQ' + run } })).body; // mêmes bases : l'API 2FA obligatoire la voit
    const m3 = `rq.${run.toLowerCase()}@t.test`;
    await call('POST', `/organizations/${org2.id}/admins`, { token: adm.body.access_token, body: { email: m3, full_name: 'Chef', password: pw } });
    const t3 = await lg(m3, pw);
    const blocked = await c2('GET', '/users', { token: t3, org: org2.id });
    check('sans 2FA : accès bloqué (TWO_FACTOR_REQUIRED)', blocked.status === 403 && blocked.body?.code === 'TWO_FACTOR_REQUIRED', blocked);
    const me = await c2('GET', '/me', { token: t3, org: org2.id });
    check('/me reste ouvert et signale must_setup_2fa', me.status === 200 && me.body.must_setup_2fa === true, me);
    const sp = await c2('POST', '/auth/2fa/setup', { token: t3 });
    const enb = await c2('POST', '/auth/2fa/enable', { token: t3, body: { code: totpCode(sp.body.secret, stepAt()) } });
    check('activation possible malgré le blocage', enb.status === 200, enb);
    check('après activation : accès rétabli', (await c2('GET', '/users', { token: t3, org: org2.id })).status === 200);
  }
  console.log(`\n${ok} réussis, ${ko} échecs`); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
