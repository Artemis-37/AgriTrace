// Test de bout en bout : messagerie entre postes et rejeu hors connexion.
const crypto = require('crypto');
const API = process.env.API || 'http://localhost:3000/v1';
const run = crypto.randomBytes(3).toString('hex').toUpperCase();
let ok = 0, ko = 0;
async function call(method, path, { token, org, body, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (org) headers['x-organization-id'] = org;
  let payload;
  if (body) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  if (form) payload = form;
  const res = await fetch(API + path, { method, headers, body: payload });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const check = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓', name); } else { ko++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); } };
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.access_token;
const pw = 'MotDePasseSolide2026!';
const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;

(async () => {
  const adm = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const org = (await call('POST', '/organizations', { token: adm, body: { code: 'MSG' + run, name: 'MSG' + run } })).body;
  const org2 = (await call('POST', '/organizations', { token: adm, body: { code: 'MSX' + run, name: 'MSX' + run } })).body;
  const mail = `msg.${run}@t.test`;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email: mail, full_name: 'Chef Poste', password: pw } });
  const t0 = await login(mail, pw);
  const J = (tok) => ({ token: tok, org: org.id });
  const role = async (code, permissions) => (await call('POST', '/roles', { ...J(t0), body: { code, name: code, permissions } })).body;
  const rOk = await role('poste', ['messages:use', 'sync:use', 'producers:read']);
  const rNo = await role('sans_messages', ['producers:read']);
  const user = async (tag, r) => { const email = `${tag}.${run}@t.test`; const u = (await call('POST', '/users', { ...J(t0), body: { email, full_name: tag, password: pw, role_id: r.id } })).body; return { id: u.id, t: await login(email, pw) }; };
  const a = await user('alice', rOk), b = await user('bruno', rOk), c = await user('carole', rOk), n = await user('nina', rNo);
  check('mise en place', !!(a.id && b.id && c.id && n.id));

  console.log('Messages directs et canal général');
  const m1 = await call('POST', '/messages', { ...J(a.t), body: { idempotency_key: key('m'), to: b.id, body: 'Bonjour Bruno, le camion arrive à 15 h.' } });
  check('envoi d\'un message direct', m1.status === 201 && m1.body.recipient_id === b.id, m1.body);
  const k = key('m');
  const g1 = await call('POST', '/messages', { ...J(a.t), body: { idempotency_key: k, body: 'Réunion à 17 h pour tous.' } });
  const g2 = await call('POST', '/messages', { ...J(a.t), body: { idempotency_key: k, body: 'Réunion à 17 h pour tous.' } });
  check('renvoi de la même clé : pas de doublon', g1.body.id === g2.body.id);
  check('un autre utilisateur ne peut pas réutiliser la clé', (await call('POST', '/messages', { ...J(b.t), body: { idempotency_key: k, body: 'x' } })).status === 403);
  check('destinataire hors coopérative refusé', (await call('POST', '/messages', { ...J(a.t), body: { idempotency_key: key('m'), to: crypto.randomUUID(), body: 'x' } })).status === 400);
  check('message à soi-même refusé', (await call('POST', '/messages', { ...J(a.t), body: { idempotency_key: key('m'), to: a.id, body: 'x' } })).status === 400);
  check('message vide refusé', (await call('POST', '/messages', { ...J(a.t), body: { idempotency_key: key('m'), to: b.id, body: '' } })).status === 400);
  check('sans la permission : refusé', (await call('POST', '/messages', { ...J(n.t), body: { idempotency_key: key('m'), body: 'x' } })).status === 403);

  console.log('Confidentialité');
  const tb = await call('GET', `/messages?with=${a.id}`, J(b.t));
  check('le destinataire lit le message', tb.status === 200 && tb.body.length === 1 && tb.body[0].body.includes('camion') && tb.body[0].sender_name === 'alice', tb.body);
  const tc = await call('GET', `/messages?with=${a.id}`, J(c.t));
  check('un tiers ne voit pas le message direct', tc.status === 200 && tc.body.length === 0, tc.body);
  const tc2 = await call('GET', `/messages?with=${b.id}`, J(c.t));
  check('un tiers ne voit pas non plus l\'autre sens', tc2.body.length === 0);
  const gen = await call('GET', '/messages?with=general', J(c.t));
  check('le canal général est lu par tous les membres', gen.body.length === 1 && gen.body[0].body.includes('Réunion'), gen.body);
  check('autre coopérative : pas d\'accès', (await call('GET', '/messages?with=general', { token: t0, org: org2.id })).status === 403);
  check('paramètre invalide refusé', (await call('GET', '/messages?with=nimporte', J(b.t))).status === 400);

  console.log('Non lus');
  const ct = await call('GET', '/messages/contacts', J(b.t));
  const fromA = ct.body.contacts.find((x) => x.id === a.id);
  check('contacts : 1 message non lu d\'Alice, canal général 1', fromA?.unread === 1 && ct.body.general.unread === 1 && !ct.body.contacts.some((x) => x.id === b.id), ct.body);
  check('compteur global = 2', (await call('GET', '/messages/unread-count', J(b.t))).body.unread === 2);
  await call('POST', '/messages/seen', { ...J(b.t), body: { with: a.id } });
  check('après lecture du fil direct : 1 restant', (await call('GET', '/messages/unread-count', J(b.t))).body.unread === 1);
  await call('POST', '/messages/seen', { ...J(b.t), body: { with: 'general' } });
  check('après lecture du canal : 0', (await call('GET', '/messages/unread-count', J(b.t))).body.unread === 0);
  check('l\'expéditeur n\'a pas de non lu pour son propre message', (await call('GET', '/messages/unread-count', J(a.t))).body.unread === 0);
  await call('POST', '/messages', { ...J(a.t), body: { idempotency_key: key('m'), to: b.id, body: 'Un second message.' } });
  check('un nouveau message redevient non lu', (await call('GET', '/messages/unread-count', J(b.t))).body.unread === 1);

  console.log('Rejeu depuis un poste hors connexion (/sync/batch)');
  const kk = key('off');
  const op = { idempotency_key: kk, type: 'message.send', payload: { idempotency_key: kk, to: c.id, body: 'Écrit sans réseau.', sent_at: new Date(Date.now() - 3600e3).toISOString() } };
  const r1 = await call('POST', '/sync/batch', { ...J(a.t), body: { operations: [op] } });
  check('message rejoué : accepté', r1.status === 201 && r1.body.results[0].status === 'accepted', r1.body);
  const r2 = await call('POST', '/sync/batch', { ...J(a.t), body: { operations: [op] } });
  check('rejoué une seconde fois : même résultat, pas de doublon', r2.body.results[0].status === 'accepted');
  const tcc = await call('GET', `/messages?with=${a.id}`, J(c.t));
  check('Carole le reçoit une seule fois, avec l\'heure de rédaction', tcc.body.filter((m) => m.body === 'Écrit sans réseau.').length === 1 && !!tcc.body[0].sent_at, tcc.body);
  const bad = await call('POST', '/sync/batch', { ...J(n.t), body: { operations: [{ ...op, idempotency_key: key('off') }] } });
  check('sans permission sync : refusé', bad.status === 403);
  const tamper = await call('POST', '/sync/batch', { ...J(a.t), body: { operations: [{ ...op, payload: { ...op.payload, body: 'modifié' } }] } });
  check('même clé, contenu différent : conflit', tamper.body.results[0].status === 'conflit' || tamper.body.results[0].status === 'conflict', tamper.body);

  console.log(`\n${ok} contrôles réussis, ${ko} en échec`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
