#!/usr/bin/env node
// Signature des installateurs AgriTrace (Ed25519). À faire sur la machine du développeur, JAMAIS sur le serveur de la coopérative.
//   node scripts/sign-release.js keygen [dossier-secret]      → crée release-private.pem (À GARDER SECRÈTE, hors du dépôt) et src/release-public-key.pem (à livrer avec l'application)
//   node scripts/sign-release.js sign <installateur.exe> <version> [release-private.pem]   → affiche la signature à coller lors du dépôt de l'installateur
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { releaseMessage } = require('../src/updater');

const [cmd, a, b, c] = process.argv.slice(2);
if (cmd === 'keygen') {
  const dir = a || process.cwd();
  const priv = path.join(dir, 'release-private.pem');
  if (fs.existsSync(priv)) { console.error('Une clé existe déjà : ' + priv + ' (non écrasée).'); process.exit(1); }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'release-public-key.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
  console.log('Clé privée : ' + priv + '\n→ sauvegardez-la en lieu sûr (coffre, clé USB chiffrée) : sans elle, plus aucune mise à jour ne pourra être signée.\nClé publique : desktop/src/release-public-key.pem (à reconstruire dans l\'application : npm run dist).');
} else if (cmd === 'sign') {
  if (!a || !b) { console.error('Usage : sign <installateur.exe> <version> [release-private.pem]'); process.exit(1); }
  const sha = crypto.createHash('sha256').update(fs.readFileSync(a)).digest('hex');
  const key = crypto.createPrivateKey(fs.readFileSync(c || 'release-private.pem'));
  const sig = crypto.sign(null, releaseMessage(b, sha), key).toString('base64');
  console.log(`Version : ${b}\nSHA-256 : ${sha}\nSignature (à coller dans « Signature » lors du dépôt) :\n${sig}`);
} else { console.error('Commandes : keygen | sign'); process.exit(1); }
