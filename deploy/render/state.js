// État de la démonstration dans la base Render : « empty » (rien), « done » (chargée en entier), « outdated » (chargée mais d'une ancienne version) ou « partial » (interrompue).
// Usage : node scripts/render-state.js [reset|mark]
const { Client } = require('pg');
// Version du contenu de démonstration : en la changeant, la prochaine mise en ligne remet la base de démonstration à zéro et la recharge.
// Le mot de passe de démonstration (DEMO_PASSWORD) fait partie de la version : le changer dans Render recharge la démonstration avec le nouveau mot de passe (empreinte salée, jamais le mot de passe lui-même).
const crypto = require('crypto');
const PW = process.env.DEMO_PASSWORD || 'Demo-AgriTrace-2026!';
const DEMO_VERSION = '2026-10-28-volume-70-producteurs-' + crypto.createHash('sha256').update(PW + (process.env.JWT_SECRET || '')).digest('hex').slice(0, 12);
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
      await c.query('ALTER TABLE demo_seed_done ADD COLUMN IF NOT EXISTS version text');
      await c.query('INSERT INTO demo_seed_done(version) VALUES ($1)', [DEMO_VERSION]);
      console.log('marked');
    } else {
      const r = await c.query(`SELECT to_regclass('public.demo_seed_done') AS d, to_regclass('public.organizations') AS o`);
      if (r.rows[0].d) {
        const has = (await c.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'demo_seed_done' AND column_name = 'version'`)).rowCount;
        const v = has ? (await c.query('SELECT version FROM demo_seed_done ORDER BY done_at DESC LIMIT 1')).rows[0]?.version : null;
        console.log(v === DEMO_VERSION ? 'done' : 'outdated');
      }
      else if (!r.rows[0].o) console.log('empty');
      else console.log((await c.query('SELECT count(*)::int AS n FROM organizations')).rows[0].n === 0 ? 'empty' : 'partial');
    }
  } finally { await c.end(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
