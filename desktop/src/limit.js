// Limite d'utilisation : une version d'essai embarque une date d'expiration (fichier usage-limit.json à côté de l'application, signé).
// Sans ce fichier, l'application n'a aucune limite. Le contrôle écarte aussi le retour en arrière de l'horloge du poste.
// Limite : c'est une protection locale, qui arrête l'usage normal ; elle ne résiste pas à un utilisateur déterminé qui modifie l'application.
const crypto = require('crypto');
const fs = require('fs');

const KEY = 'agritrace-usage-limit-v1-7f3c9a1e5b2d48c6';
const DAY = 86400000;
const sign = (issued, expires, days) => crypto.createHmac('sha256', KEY).update(`${issued}|${expires}|${days}`).digest('hex');

/** Contenu du fichier de limite pour `days` jours à partir de `now`. */
function make(days, now = Date.now()) {
  const issued = new Date(now).toISOString(), expires = new Date(now + days * DAY).toISOString();
  return { issued, expires, days, sig: sign(issued, expires, days) };
}

/** @returns {{status:'none'|'ok'|'expired'|'tampered'|'clock', daysLeft?:number, expires?:string}} */
function check({ file, stateFile, now = Date.now() }) {
  if (!fs.existsSync(file)) return { status: 'none' };
  let l;
  try { l = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { status: 'tampered' }; }
  const ok = l && typeof l.sig === 'string' && l.sig.length === 64 && crypto.timingSafeEqual(Buffer.from(l.sig), Buffer.from(sign(l.issued, l.expires, l.days)));
  const exp = Date.parse(l?.expires), iss = Date.parse(l?.issued);
  if (!ok || Number.isNaN(exp) || Number.isNaN(iss)) return { status: 'tampered' };
  // Dernier passage connu : une horloge remise en arrière (plus d'un jour) ou antérieure à la date de fabrication est refusée.
  let last = iss;
  try { last = Math.max(last, JSON.parse(fs.readFileSync(stateFile, 'utf8')).last ?? 0); } catch { /* premier lancement */ }
  if (now < last - DAY) return { status: 'clock', expires: l.expires };
  try { fs.writeFileSync(stateFile, JSON.stringify({ last: Math.max(last, now) })); } catch { /* dossier en lecture seule : sans conséquence */ }
  if (now >= exp) return { status: 'expired', daysLeft: 0, expires: l.expires };
  return { status: 'ok', daysLeft: Math.ceil((exp - now) / DAY), expires: l.expires };
}

const MESSAGES = {
  expired: (r) => ({ message: "La période d'utilisation de cette version d'AgriTrace est terminée.", detail: `Elle a pris fin le ${new Date(r.expires).toLocaleDateString('fr-FR')}. Installez la version la plus récente fournie par votre administrateur. Vos données sont conservées.` }),
  tampered: () => ({ message: "Le fichier de limite d'utilisation d'AgriTrace est invalide.", detail: "Réinstallez AgriTrace avec l'installateur d'origine. Vos données sont conservées." }),
  clock: () => ({ message: "L'horloge de ce poste semble avoir été reculée.", detail: "Remettez la date et l'heure exactes de l'ordinateur, puis relancez AgriTrace." }),
};

module.exports = { make, check, MESSAGES, DAY };
