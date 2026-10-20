// Test de charge simple (Node ≥ 18, sans dépendance) : N utilisateurs virtuels pendant D secondes sur des routes de lecture.
// Usage : API=http://localhost:3000/v1 EMAIL=… PASSWORD=… ORG=<uuid organisation> [VUS=20] [DURATION=20] node scripts/load-test.js
// À lancer sur un environnement de préproduction, jamais sur la production. Ne crée aucune donnée.
const API = process.env.API || 'http://localhost:3000/v1';
const VUS = +(process.env.VUS || 20), DURATION = +(process.env.DURATION || 20);
const paths = (process.env.PATHS || '/producers,/me,/alerts,/stock,/accounting/trial-balance').split(',');

(async () => {
  const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.EMAIL, password: process.env.PASSWORD }) });
  if (!r.ok) throw new Error('connexion impossible : ' + r.status);
  const token = (await r.json()).access_token;
  const h = { authorization: 'Bearer ' + token, 'x-organization-id': process.env.ORG || '' };
  const lat = [], status = {}; let stop = false;
  setTimeout(() => (stop = true), DURATION * 1000);
  const t0 = Date.now();
  await Promise.all(Array.from({ length: VUS }, async (_, v) => {
    for (let i = v; !stop; i++) {
      const p = paths[i % paths.length], s = process.hrtime.bigint();
      let code = 'ERR';
      try { const res = await fetch(API + p, { headers: h }); await res.arrayBuffer(); code = res.status; } catch {}
      lat.push(Number(process.hrtime.bigint() - s) / 1e6);
      status[code] = (status[code] || 0) + 1;
    }
  }));
  lat.sort((a, b) => a - b);
  const q = (x) => lat[Math.min(lat.length - 1, Math.floor(lat.length * x))].toFixed(1);
  const secs = (Date.now() - t0) / 1000;
  console.log(JSON.stringify({ vus: VUS, secondes: +secs.toFixed(1), requetes: lat.length, req_par_s: +(lat.length / secs).toFixed(1), p50_ms: +q(0.5), p95_ms: +q(0.95), p99_ms: +q(0.99), statuts: status }, null, 2));
  console.log('Note : le limiteur de débit (120/min/IP par défaut) renvoie 429 ; pour mesurer la capacité réelle, tester depuis plusieurs IP ou avec un seuil relevé en préproduction.');
})().catch((e) => { console.error(e.message); process.exit(1); });
