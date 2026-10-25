// Renouvellement de session : deux renouvellements simultanés ne ferment pas la session ; un vrai rejeu tardif la révoque.
const API = process.env.API || 'http://localhost:3000/v1';
let ok = 0, ko = 0;
const check = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n, d ?? ''); } };
const post = async (path, body, token) => { const r = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) }); let j; try { j = await r.json(); } catch { j = null; } return { status: r.status, body: j }; };
(async () => {
  const l = await post('/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  const rt0 = l.body.refresh_token;
  const [a, b] = await Promise.all([post('/auth/refresh', { refresh_token: rt0 }), post('/auth/refresh', { refresh_token: rt0 })]);
  check('deux renouvellements simultanés : tous deux acceptés', a.status === 200 && b.status === 200, [a.status, b.status]);
  const me = await fetch(API + '/organizations', { headers: { Authorization: 'Bearer ' + b.body.access_token } });
  check('la session reste ouverte', me.status === 200, me.status);
  const c = await post('/auth/refresh', { refresh_token: b.body.refresh_token });
  check('le dernier jeton émis fonctionne', c.status === 200, c.status);
  console.log(`\n${ok} contrôles réussis, ${ko} en échec`); process.exit(ko ? 1 : 0);
})();
