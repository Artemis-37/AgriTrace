// État de la démonstration dans la base Render : « empty » (rien), « done » (chargée en entier) ou « partial » (interrompue).
// Usage : node scripts/render-state.js [reset|mark]
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.OWNER_DATABASE_URL });
  await c.connect();
  try {
    const act = process.argv[2];
    if (act === 'reset') {
      // Base de démonstration jetable : on repart de zéro (appelé seulement si un chargement a été interrompu).
      await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      console.log('reset');
    } else if (act === 'mark') {
      await c.query('CREATE TABLE IF NOT EXISTS demo_seed_done (done_at timestamptz NOT NULL DEFAULT now())');
      await c.query('INSERT INTO demo_seed_done DEFAULT VALUES');
      console.log('marked');
    } else {
      const r = await c.query(`SELECT to_regclass('public.demo_seed_done') AS d, to_regclass('public.organizations') AS o`);
      if (r.rows[0].d) console.log('done');
      else if (!r.rows[0].o) console.log('empty');
      else console.log((await c.query('SELECT count(*)::int AS n FROM organizations')).rows[0].n === 0 ? 'empty' : 'partial');
    }
  } finally { await c.end(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
