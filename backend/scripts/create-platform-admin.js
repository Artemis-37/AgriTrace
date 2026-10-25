// Usage : DATABASE_URL=... node scripts/create-platform-admin.js email "Nom complet"
// Le mot de passe est demandé via la variable ADMIN_PASSWORD (jamais en argument de ligne de commande).
const { Client } = require('pg');
const argon2 = require('argon2');

(async () => {
  const [email, name] = process.argv.slice(2);
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !name || !password || password.length < 12) {
    console.error('Usage : ADMIN_PASSWORD=<12+ caractères> node scripts/create-platform-admin.js email "Nom"');
    process.exit(1);
  }
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  await c.query(
    `INSERT INTO users(email, full_name, password_hash, is_platform_admin) VALUES ($1,$2,$3,true)
     ON CONFLICT (email) DO UPDATE SET is_platform_admin = true`,
    [email.toLowerCase(), name, hash],
  );
  // RESET_PASSWORD=1 : un compte déjà existant reçoit aussi ce mot de passe (et son verrouillage éventuel est levé). Sert aux essais jetables (Render, Fly).
  if (process.env.RESET_PASSWORD === '1') {
    await c.query('UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL WHERE email = $1', [email.toLowerCase(), hash]);
    console.log('Mot de passe réinitialisé :', email);
  }
  console.log('Administrateur de plateforme prêt :', email);
  await c.end();
})();
