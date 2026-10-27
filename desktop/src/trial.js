// Période d'essai : N jours à partir du premier lancement. La date de premier lancement est écrite à plusieurs endroits (profil de l'utilisateur,
// dossier commun de la machine, registre Windows) ; on retient la plus ancienne. Un recul de l'horloge est détecté.
// Limite assumée : une protection côté poste ralentit un contournement, elle ne l'empêche pas contre quelqu'un de déterminé.
const crypto = require('crypto');
const DAY = 86400000;
const KEY = 'agritrace-essai-v1-0b7f3c2e91d84a56';   // intégrité des fichiers (empêche la modification à la main), pas un secret fort

const sign = (first, last) => crypto.createHmac('sha256', KEY).update(`${first}.${last}`).digest('hex');
const encode = (first, last) => JSON.stringify({ first, last, sig: sign(first, last) });
function decode(raw) {
  if (raw == null) return null;
  try { const j = JSON.parse(raw); return j && Number.isFinite(j.first) && Number.isFinite(j.last) && j.sig === sign(j.first, j.last) ? { first: j.first, last: j.last } : { bad: true }; }
  catch { return { bad: true }; }
}

/**
 * stores : [{ read(): string|null, write(string) }]. Renvoie { state: 'ok'|'expired'|'tampered', daysLeft, firstLaunch }.
 * Premier lancement : aucune trace nulle part. Une trace illisible ou modifiée alors que les autres existent : on garde la plus ancienne valide.
 */
function evaluate({ now = Date.now(), days = 30, stores }) {
  const found = stores.map((s) => { try { return decode(s.read()); } catch { return null; } });
  const valid = found.filter((f) => f && !f.bad);
  const anyBad = found.some((f) => f && f.bad);
  let first, last;
  if (!valid.length) {
    if (anyBad) return { state: 'tampered', daysLeft: 0 };   // traces présentes mais toutes altérées
    first = now; last = now;
  } else {
    first = Math.min(...valid.map((v) => v.first));
    last = Math.max(...valid.map((v) => v.last));
  }
  if (now < last - DAY) { return { state: 'tampered', daysLeft: 0, firstLaunch: first }; }   // horloge reculée de plus d'un jour
  last = Math.max(last, now);
  for (const s of stores) { try { s.write(encode(first, last)); } catch { /* emplacement indisponible : les autres suffisent */ } }
  const end = first + days * DAY;
  const daysLeft = Math.max(0, Math.ceil((end - now) / DAY));
  return { state: now >= end ? 'expired' : 'ok', daysLeft, firstLaunch: first };
}

module.exports = { evaluate, encode, decode, DAY };
