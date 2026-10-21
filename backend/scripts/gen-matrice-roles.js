// Génère docs/MATRICE_ROLES.md depuis le code : permissions (migrations), routes qui les exigent (contrôleurs) et rôles types.
// Usage : npm run build && node scripts/gen-matrice-roles.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const perms = new Map();
for (const f of fs.readdirSync(path.join(root, 'migrations')).filter((x) => x.endsWith('.sql')).sort()) {
  const sql = fs.readFileSync(path.join(root, 'migrations', f), 'utf8');
  for (const blk of sql.match(/INSERT INTO permissions\s*\(code, description\)\s*VALUES[\s\S]*?(?:ON CONFLICT[^;]*)?;/g) ?? [])
    for (const m of blk.matchAll(/\(\s*'([a-z_]+:[a-z_]+)'\s*,\s*'((?:[^']|'')*)'\s*\)/g)) perms.set(m[1], m[2].replace(/''/g, "'"));
}
const routes = new Map(); // permission -> ["GET /x", ...]
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.controller.ts') ? [path.join(d, e.name)] : []);
for (const file of walk(path.join(root, 'src'))) {
  const src = fs.readFileSync(file, 'utf8');
  const prefix = (src.match(/@Controller\('([^']*)'\)/) ?? [])[1] ?? '';
  const classPerms = (src.match(/@RequirePermissions\(([^)]*)\)\s*(?:\n\s*)?(?:@[A-Za-z]+\([^)]*\)\s*)*export class/) ?? [])[1];
  for (const m of src.matchAll(/@(Get|Post|Put|Patch|Delete)\(([^)]*)\)([^\n]*)/g)) {
    const rest = m[3] + src.slice(m.index + m[0].length, m.index + m[0].length + 400).split(/\n\s*(?:async\s+)?[a-zA-Z_]+\(/)[0];
    const rp = rest.match(/@RequirePermissions\(([^)]*)\)/) ?? (classPerms ? [null, classPerms] : null);
    if (!rp) continue;
    const sub = (m[2].match(/'([^']*)'/) ?? [])[1] ?? '';
    const url = '/' + [prefix, sub].filter(Boolean).join('/').replace(/\/+/g, '/');
    for (const p of [...rp[1].matchAll(/'([a-z_]+:[a-z_]+)'/g)].map((x) => x[1])) {
      if (!routes.has(p)) routes.set(p, []);
      routes.get(p).push(`${m[1].toUpperCase()} ${url}`);
    }
  }
}
const { STANDARD_ROLES } = require(path.join(root, 'dist/users/standard-roles.js'));
const all = [...new Set([...perms.keys(), ...routes.keys()])].sort();
const groups = {};
for (const p of all) (groups[p.split(':')[0]] ??= []).push(p);
const roles = Object.entries(STANDARD_ROLES);
let out = `# Matrice des rôles et permissions (CDC §5, §35)

Fichier généré par \`backend/scripts/gen-matrice-roles.js\` à partir du code : ne pas le modifier à la main. Les menus du portail et les routes de l'API se règlent sur les **permissions**, jamais sur le nom du rôle. Une coopérative crée ses propres rôles en combinant ces permissions ; les cinq rôles ci-dessous sont des modèles proposés.

${all.length} permissions, ${[...routes.values()].reduce((a, b) => a + b.length, 0)} routes protégées. Les droits sensibles (paiements, ajustements, exports de noms) peuvent en plus exiger une seconde approbation, réglée par rôle.

## Rôles types
${roles.map(([k, r]) => `- **${r.name}** (\`${k}\`) : ${r.description}`).join('\n')}

## Permissions par domaine
Colonnes : ✓ = accordé par le rôle type. Les rôles Administrateur de coopérative et Administrateur de plateforme ne figurent pas : le premier gère les utilisateurs et les rôles de sa coopérative, le second crée les coopératives et n'a pas accès à leurs données.

`;
for (const [g, list] of Object.entries(groups)) {
  out += `### ${g}\n| Permission | Rôle du droit | ${roles.map(([, r]) => r.name.replace(/ \(.*/, '')).join(' | ')} | Routes |\n|---|---|${roles.map(() => ':-:').join('|')}|---|\n`;
  for (const p of list) {
    const rs = [...new Set(routes.get(p) ?? [])];
    const shown = rs.slice(0, 3).map((x) => `\`${x}\``).join('<br>') + (rs.length > 3 ? `<br>… +${rs.length - 3}` : '');
    out += `| \`${p}\` | ${perms.get(p) ?? '—'} | ${roles.map(([, r]) => (r.permissions.includes(p) ? '✓' : '')).join(' | ')} | ${shown || '—'} |\n`;
  }
  out += '\n';
}
const unk = roles.flatMap(([k, r]) => r.permissions.filter((p) => !all.includes(p)).map((p) => `${k}:${p}`));
if (unk.length) { console.error('Permissions de rôle type inconnues :', unk.join(', ')); process.exit(1); }
fs.writeFileSync(path.join(root, '..', 'docs', 'MATRICE_ROLES.md'), out);
console.log(`docs/MATRICE_ROLES.md : ${all.length} permissions, ${routes.size} avec routes`);
