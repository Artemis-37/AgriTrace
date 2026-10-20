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
  // Les déclencheurs de réplication couvrent aussi les tables ajoutées par les migrations précédentes (idempotent).
  await client.query('SELECT replication_install_triggers()');
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
