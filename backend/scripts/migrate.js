// Applique les migrations SQL de ./migrations dans l'ordre, une seule fois chacune.
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const done = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [f]);
    if (done.rowCount) continue;
    console.log('Migration', f);
    await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
  }
  // Étape facultative : PostGIS (colonne géométrique générée + index GiST) si l'extension est disponible. Idempotente.
  const optional = path.join(dir, 'optional', 'postgis.sql');
  if (process.env.POSTGIS === 'off') console.log('PostGIS : désactivé par POSTGIS=off');
  else if (fs.existsSync(optional)) {
    const notices = [];
    client.on('notice', (n) => notices.push(n.message));
    await client.query(fs.readFileSync(optional, 'utf8'));
    for (const m of notices.filter((x) => !/already exists|existe déjà/.test(x))) console.log('PostGIS :', m);
    const on = await client.query(`SELECT 1 FROM pg_attribute WHERE attrelid = 'parcels'::regclass AND attname = 'geom' AND NOT attisdropped`);
    console.log(on.rowCount ? 'PostGIS : actif (colonne parcels.geom + index GiST)' : 'PostGIS : inactif (repli : calcul par l\'application)');
  }
  // Les déclencheurs de réplication couvrent aussi les tables ajoutées par les migrations précédentes (idempotent).
  await client.query('SELECT replication_install_triggers()');
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
