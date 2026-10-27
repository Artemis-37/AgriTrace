// Écrit le fichier de limite d'utilisation dans le dossier de ressources d'un build : node scripts/write-limit.js <jours> <dossier-resources>
const fs = require('fs');
const path = require('path');
const { make } = require('../src/limit');
const [days, dir] = [Number(process.argv[2]), process.argv[3]];
if (!days || days < 1 || !dir) { console.error('usage : node scripts/write-limit.js <jours> <dossier-resources>'); process.exit(1); }
const l = make(days);
fs.writeFileSync(path.join(dir, 'usage-limit.json'), JSON.stringify(l, null, 2));
console.log(`limite de ${days} jours : fin le ${l.expires}`);
