// Assemble payload/ : ce qui est embarqué dans l'installateur (API compilée, migrations, dépendances de production, portail web).
// Prérequis : `npm run build` dans backend/ et dans web/. À exécuter sur la plateforme cible (Windows) : les modules natifs (argon2) y sont installés.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const out = path.resolve(__dirname, '..', 'payload');
fs.rmSync(out, { recursive: true, force: true });
const be = path.join(out, 'backend');
fs.mkdirSync(path.join(be, 'scripts'), { recursive: true });

for (const need of [path.join(root, 'backend', 'dist', 'main.js'), path.join(root, 'web', 'dist', 'index.html')]) {
  if (!fs.existsSync(need)) { console.error(`Manquant : ${need} — lancez d'abord les builds du backend et du web.`); process.exit(1); }
}
fs.cpSync(path.join(root, 'backend', 'dist'), path.join(be, 'dist'), { recursive: true });
fs.cpSync(path.join(root, 'backend', 'migrations'), path.join(be, 'migrations'), { recursive: true });
fs.copyFileSync(path.join(root, 'backend', 'scripts', 'migrate.js'), path.join(be, 'scripts', 'migrate.js'));
fs.copyFileSync(path.join(root, 'backend', 'package.json'), path.join(be, 'package.json'));
fs.copyFileSync(path.join(root, 'backend', 'package-lock.json'), path.join(be, 'package-lock.json'));
fs.cpSync(path.join(root, 'web', 'dist'), path.join(out, 'web'), { recursive: true });
execSync('npm ci --omit=dev --no-audit --no-fund', { cwd: be, stdio: 'inherit' });
console.log('Payload prêt :', out);
