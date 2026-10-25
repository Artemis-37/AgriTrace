// Prépare la base fournie par Render : crée (ou met à jour) le rôle applicatif NON propriétaire, indispensable à la sécurité par ligne (RLS),
// puis écrit l'adresse de connexion de l'API dans /tmp/app-db-url. Si la création du rôle est refusée, l'API retombe sur le compte propriétaire (essai seulement).
const { Client } = require('pg');
const fs = require('fs');
(async () => {
  const owner = process.env.OWNER_DATABASE_URL;
  const pw = process.env.APP_PW;
  if (!owner || !pw) throw new Error('OWNER_DATABASE_URL et APP_PW sont requis');
  const c = new Client({ connectionString: owner });
  await c.connect();
  let ok = false;
  try {
    const { rows: [{ u, d }] } = await c.query('SELECT current_user AS u, current_database() AS d');
    const has = await c.query(`SELECT 1 FROM pg_roles WHERE rolname='agritrace_app'`);
    const lit = pw.replace(/'/g, "''");
    if (has.rowCount) await c.query(`ALTER ROLE agritrace_app LOGIN PASSWORD '${lit}'`);
    else await c.query(`CREATE ROLE agritrace_app LOGIN PASSWORD '${lit}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await c.query(`GRANT CONNECT ON DATABASE "${d}" TO agritrace_app; GRANT USAGE ON SCHEMA public TO agritrace_app;
      ALTER DEFAULT PRIVILEGES FOR ROLE "${u}" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO agritrace_app;
      ALTER DEFAULT PRIVILEGES FOR ROLE "${u}" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO agritrace_app;
      ALTER DEFAULT PRIVILEGES FOR ROLE "${u}" IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO agritrace_app`);
    ok = true;
    console.log('[render] rôle applicatif agritrace_app prêt');
  } catch (e) {
    console.warn('[render] ATTENTION : rôle applicatif impossible (' + e.message + ') — l\'API utilise le compte propriétaire : la sécurité par ligne n\'est PAS garantie. Essai uniquement.');
  }
  await c.end();
  const u = new URL(owner);
  if (ok) { u.username = 'agritrace_app'; u.password = pw; }
  fs.writeFileSync('/tmp/app-db-url', u.toString());
})().catch((e) => { console.error('[render] préparation impossible :', e); process.exit(1); });
