// Builds sessions/<id>/rapport.html: one self-contained page that shows who said what, who contradicted whom,
// who moved, and the verdict. Opens without the room or any server.
// Usage: node app/scripts/rapport.mjs sessions/<date>-<decision>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEATS, byKey, parseCard, parseOptionScores } from "../lib/seats.mjs";
import { splitCards, seatKey } from "../lib/watch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(process.argv[2] || "");
if (!process.argv[2] || !fs.existsSync(path.join(dir, "council.json"))) {
  console.error("Usage : node app/scripts/rapport.mjs sessions/<date>-<décision>");
  process.exit(1);
}
const read = (n) => (fs.existsSync(path.join(dir, n)) ? fs.readFileSync(path.join(dir, n), "utf8") : "");
const json = (n) => { try { return JSON.parse(read(n)); } catch { return null; } };

const council = json("council.json");
const cruxes = json("cruxes.json");
const verdict = json("verdict.json");
const optionIds = (council.options || []).map((o) => o.id);
const optLabel = Object.fromEntries((council.options || []).map((o) => [o.id, o.label]));
const weights = Object.fromEntries(Object.entries(council.weights || {}).map(([k, v]) => [seatKey(k) || k, v]));
const seatsAtTable = (council.seats || SEATS.map((s) => s.key)).map((k) => seatKey(k) || k).filter((k) => byKey[k]);

// ---------- card parsing (multi-line blocks) ----------
const LABELS = ["SEAT", "STANCE", "OPTION SCORES", "PILLAR SCORE", "CONFIDENCE", "RUIN RISK", "DOOR", "THE CALL", "WHY",
  "THE RISK I SEE", "WHAT WOULD CHANGE MY MIND", "WHAT I'D DO THIS WEEK", "QUESTION FOR THE FOUNDER",
  "I DISAGREE MOST WITH", "I CONCEDE", "ON THE CRUXES", "MOVED", "MY CONDITIONS FOR YES",
  "VOTE", "FINAL SCORE", "FINAL PILLAR SCORE", "AMENDMENT OR DISSENT", "ONE LINE FOR THE FOUNDER"];
const LABEL_RE = new RegExp(`^\\**(${LABELS.map((l) => l.replace(/'/g, "['’]")).join("|")})\\**[ \\t]*:[ \\t]*(.*)$`);

function blocks(text) {
  const out = {};
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(LABEL_RE);
    if (m) { cur = m[1].replace(/’/g, "'"); out[cur] = m[2].trim(); }
    else if (cur) out[cur] += "\n" + line;
  }
  for (const k of Object.keys(out)) out[k] = out[k].trim();
  return out;
}

function chairNotes(md) {
  const m = md.match(/^##[ \t]+(notes du président|président|chair[^\n]*)\s*$/im);
  if (!m) return "";
  const rest = md.slice(m.index + m[0].length);
  const next = rest.search(/^##[ \t]+/m);
  return (next >= 0 ? rest.slice(0, next) : rest).trim();
}

const rounds = {};
for (const r of [1, 2, 3]) {
  const md = read(`round-${r}.md`);
  if (!md) continue;
  const cards = {};
  for (const c of splitCards(md)) cards[c.key] = { text: c.text, b: blocks(c.text), p: parseCard(c.text, optionIds), scores: parseOptionScores(c.text, optionIds) };
  rounds[r] = { cards, notes: chairNotes(md) };
}
const lastRound = Math.max(...Object.keys(rounds).map(Number));

// ---------- numbers ----------
const fr = (n, d = 1) => (n == null || Number.isNaN(n) ? "-" : n.toFixed(d).replace(".", ","));
function optionScores(r) {
  const res = {};
  for (const id of optionIds) {
    let n = 0, d = 0;
    for (const k of seatsAtTable) {
      const s = rounds[r]?.cards[k]?.scores[id];
      const w = weights[k]?.weight ?? 1;
      if (typeof s === "number") { n += s * w; d += w; }
    }
    res[id] = d ? n / d : null;
  }
  return res;
}
const finalScores = optionScores(lastRound);
const recommended = verdict?.recommended || Object.entries(finalScores).sort((a, b) => (b[1] ?? -1) - (a[1] ?? -1))[0]?.[0];
const favorite = (card) => {
  if (!card) return null;
  const e = Object.entries(card.scores).sort((a, b) => b[1] - a[1])[0];
  return e ? { id: e[0], score: e[1] } : null;
};

// ---------- French display ----------
const VERDICT_FR = { "GO": "ON Y VA", "GO WITH CONDITIONS": "OUI SOUS CONDITIONS", "RESHAPE": "À RETRAVAILLER", "WAIT": "PAS MAINTENANT", "DON'T DO IT": "NE LE FAIS PAS" };
const stanceFr = (s) => (s || "")
  .replace(/^Strong yes/i, "Oui franc").replace(/^Conditional yes/i, "Oui sous conditions").replace(/^Yes/i, "Oui")
  .replace(/^Strong no/i, "Non ferme").replace(/^No/i, "Non");
const voteFr = (s) => (s || "").replace(/Endorse with amendment/i, "Pour, avec amendement").replace(/Endorse/i, "Pour").replace(/Dissent/i, "Contre");
const movedFr = (s) => (s || "").replace(/^yes\b[,:]?\s*/i, "Oui : ").replace(/^no\b\.?/i, "Non");
const ruinFr = { none: "aucun", possible: "possible", likely: "probable" };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function md(s) {
  if (!s) return "";
  const lines = esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").split("\n").map((l) => l.trim()).filter(Boolean);
  let html = "", list = null;
  for (const l of lines) {
    const ol = l.match(/^\d+[.)]\s+(.*)$/), ul = l.match(/^[-*•]\s+(.*)$/);
    const kind = ol ? "ol" : ul ? "ul" : null;
    if (kind !== list) { if (list) html += `</${list}>`; if (kind) html += `<${kind}>`; list = kind; }
    html += kind ? `<li>${(ol || ul)[1]}</li>` : `<p>${l}</p>`;
  }
  if (list) html += `</${list}>`;
  return html;
}
const seatTag = (k) => {
  const s = byKey[k];
  return s ? `<span class="tag" style="--c:${s.color}"><i></i>${esc(s.short)}</span>` : esc(k);
};
const field = (label, value) => (value ? `<div class="f"><div class="fl">${label}</div><div class="fv">${md(value)}</div></div>` : "");

// ---------- sections ----------
const dateTxt = (() => {
  const m = path.basename(dir).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const mois = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  return m ? `${Number(m[3])} ${mois[Number(m[2]) - 1]} ${m[1]}` : "";
})();
const nRounds = Object.keys(rounds).length;

const maxScore = Math.max(...Object.values(finalScores).filter((x) => x != null), 1);
const bars = optionIds.map((id) => {
  const v = finalScores[id];
  const rec = id === recommended;
  return `<div class="bar${rec ? " rec" : ""}"><span class="id">${id}</span><span class="bl">${esc(optLabel[id])}</span><span class="track"><i style="width:${v == null ? 0 : (v / 10) * 100}%"></i></span><b>${fr(v)}</b>${rec ? '<em>recommandée</em>' : ""}</div>`;
}).join("");

const glance = seatsAtTable.map((k) => {
  const c1 = rounds[1]?.cards[k], cl = rounds[lastRound]?.cards[k];
  const f1 = favorite(c1), fl = favorite(cl);
  const moved = rounds[2]?.cards[k]?.b["MOVED"] || "";
  const movedShort = /^no\b/i.test(moved) || !moved ? "Non" : "Oui";
  return `<tr><td>${seatTag(k)}</td><td>${esc(byKey[k].pillar)}</td><td class="c">${weights[k]?.weight ?? 1}</td>
    <td>${f1 ? `<b>${f1.id}</b> ${fr(f1.score, 0)}/10` : "-"}<small>${esc(stanceFr(c1?.p.stance))}</small></td>
    <td>${fl ? `<b>${fl.id}</b> ${fr(fl.score, 0)}/10` : "-"}<small>${esc(stanceFr(cl?.p.stance))}</small></td>
    <td class="c">${movedShort}</td></tr>`;
}).join("");

const contradictions = rounds[2] ? seatsAtTable.map((k) => {
  const c = rounds[2].cards[k];
  if (!c) return "";
  const target = c.p.disagreeWith;
  return `<div class="fight">
    <div class="who">${seatTag(k)}<span class="arrow">contredit</span>${target ? seatTag(target) : "<span>?</span>"}</div>
    ${field("Ce qu'il répond", c.b["I DISAGREE MOST WITH"])}
    ${field("Ce qu'il concède", c.b["I CONCEDE"])}
    ${field("A-t-il bougé ?", movedFr(c.b["MOVED"]))}
  </div>`;
}).join("") : "<p class=\"muted\">Pas de tour de débat dans ce conseil.</p>";

const ruptures = (cruxes?.cruxes || []).map((q) => `<div class="crux"><h4>${esc(q.question)}</h4>${(q.sides || []).map((s) =>
  `<div class="side"><span class="pos">${esc(s.position)}</span><span class="seats">${(s.seats || []).map((x) => seatTag(seatKey(x) || x)).join("")}</span></div>`).join("")}</div>`).join("");

const perSeat = seatsAtTable.map((k) => {
  const s = byKey[k];
  const r1 = rounds[1]?.cards[k], r2 = rounds[2]?.cards[k], r3 = rounds[3]?.cards[k];
  const col = (title, c, fields) => c ? `<div class="round"><div class="rt">${title}</div>${fields.map(([l, key, fn]) => field(l, fn ? fn(c.b[key]) : c.b[key])).join("")}</div>` : "";
  return `<article class="seat" style="--c:${s.color}">
    <header><span class="dot"></span><h3>${esc(s.name)}</h3><span class="pil">${esc(s.pillar)} · poids ${weights[k]?.weight ?? 1}</span></header>
    <div class="rounds">
      ${col("Tour 1 : sa position", r1, [["Sa décision", "THE CALL"], ["Position", "STANCE", stanceFr], ["Pourquoi", "WHY"], ["Le risque qu'il voit", "THE RISK I SEE"], ["Ce qui le ferait changer d'avis", "WHAT WOULD CHANGE MY MIND"], ["Ce qu'il ferait cette semaine", "WHAT I'D DO THIS WEEK"], ["Sa question pour toi", "QUESTION FOR THE FOUNDER"]])}
      ${col("Tour 2 : le débat", r2, [["Avec qui il n'est pas d'accord", "I DISAGREE MOST WITH"], ["Ce qu'il concède", "I CONCEDE"], ["Sur les points de rupture", "ON THE CRUXES"], ["Position", "STANCE", stanceFr], ["A-t-il bougé ?", "MOVED", movedFr], ["Ses conditions pour dire oui", "MY CONDITIONS FOR YES"]])}
      ${col("Tour 3 : le vote", r3, [["Vote", "VOTE", voteFr], ["Amendement ou désaccord", "AMENDMENT OR DISSENT"], ["Sa phrase pour toi", "ONE LINE FOR THE FOUNDER"]])}
    </div>
  </article>`;
}).join("");

const notes = Object.entries(rounds).filter(([, r]) => r.notes).map(([n, r]) =>
  `<details><summary>Notes du président après le tour ${n}</summary><div class="notes">${md(r.notes)}</div></details>`).join("");

const v = verdict || {};
const verdictBlock = verdict ? `
  ${v.why?.length ? `<h3>Ce qui a fait pencher la salle</h3><ul class="why">${v.why.map((w) => `<li>${seatTag(seatKey(w.seat) || w.seat)} ${esc(w.point)}${w.framework ? ` <small>(${esc(w.framework)})</small>` : ""}</li>`).join("")}</ul>` : ""}
  ${v.minority?.seat ? `<h3>L'avis minoritaire</h3><blockquote>${seatTag(seatKey(v.minority.seat) || v.minority.seat)} « ${esc(v.minority.quote)} »<small>Pour qu'il ait raison : ${esc(v.minority.would_have_to_be_true)}</small></blockquote>` : ""}
  ${v.conditions?.length ? `<h3>Conditions</h3><ol>${v.conditions.map((c) => `<li>${esc(c)}</li>`).join("")}</ol>` : ""}
  ${v.next_steps?.length ? `<h3>Prochaines étapes</h3><ol>${v.next_steps.map((n) => `<li>${n.when ? `<b>${esc(n.when)} :</b> ` : ""}${esc(n.action || n)}</li>`).join("")}</ol>` : ""}
  ${v.cheapest_test ? `<p><b>Le test le moins cher :</b> ${esc(v.cheapest_test)}</p>` : ""}
  ${v.kill_criteria ? `<p><b>Critère d'arrêt :</b> ${esc(v.kill_criteria)}</p>` : ""}` : "";

const logo = (() => {
  const p = path.join(HERE, "..", "public", "brand", "e2-logo.png");
  return fs.existsSync(p) ? `data:image/png;base64,${fs.readFileSync(p).toString("base64")}` : "";
})();

const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GOAT · ${esc(council.title)}</title>
<style>
:root{--ink:#1a1612;--mute:#7a7268;--line:#e8e3dc;--bg:#f8f4ef;--card:#fff;--terra:#c25b28;--terra-bg:#fdf0e8}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:32px 16px 64px}
.top{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:.04em}
.top img{width:30px;height:30px;border-radius:7px}
.top span{color:var(--mute);font-weight:500;letter-spacing:0;margin-left:auto;font-size:13px}
h1{font-size:30px;line-height:1.2;margin:26px 0 6px;letter-spacing:-.01em}
.sub{color:var(--mute);margin:0 0 24px}
h2{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--terra);margin:44px 0 14px;padding-top:14px;border-top:2px solid var(--ink)}
h3{font-size:16px;margin:22px 0 8px}
.verdict{background:var(--card);border:1px solid var(--line);border-left:6px solid var(--terra);padding:22px 22px 18px}
.label{display:inline-block;background:var(--terra);color:#fff;font-weight:800;letter-spacing:.06em;padding:5px 10px;font-size:13px}
.call{font-size:18px;font-weight:600;margin:12px 0 18px}
.bar{display:grid;grid-template-columns:24px minmax(0,1.4fr) minmax(0,1fr) 42px auto;gap:10px;align-items:center;padding:6px 0;color:var(--mute)}
.bar .id{font-weight:800;color:var(--ink)}
.bar .track{height:8px;background:var(--line)}.bar .track i{display:block;height:100%;background:#cfc6bb}
.bar.rec{color:var(--ink);font-weight:600}.bar.rec .track i{background:var(--terra)}
.bar b{text-align:right;color:var(--ink)}.bar em{font-style:normal;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--terra)}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line)}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);font-weight:600}
td small{display:block;color:var(--mute);font-size:12px}td.c,th.c{text-align:center}
.tag{display:inline-flex;align-items:center;gap:6px;font-weight:700;white-space:nowrap;margin-right:6px}
.tag i{width:10px;height:10px;border-radius:50%;background:var(--c)}
.fights{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}
.fight{background:var(--card);border:1px solid var(--line);padding:16px}
.who{display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:8px}
.arrow{color:var(--terra);font-weight:700;margin:0 6px 0 0}
.f{margin-top:10px}.fl{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);font-weight:600;margin-bottom:2px}
.fv p{margin:0 0 6px}.fv ol,.fv ul{margin:4px 0 6px;padding-left:20px}
.crux{background:var(--card);border:1px solid var(--line);padding:14px 16px;margin-bottom:10px}
.crux h4{margin:0 0 8px;font-size:15px}
.side{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-top:1px dashed var(--line)}
.side .pos{color:var(--mute)}
.seat{background:var(--card);border:1px solid var(--line);border-top:5px solid var(--c);margin-bottom:16px}
.seat header{display:flex;align-items:baseline;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.seat .dot{width:12px;height:12px;border-radius:50%;background:var(--c)}
.seat h3{margin:0}.seat .pil{color:var(--mute);font-size:13px}
.rounds{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
.round{padding:4px 16px 16px;border-right:1px solid var(--line)}.round:last-child{border-right:0}
.rt{font-weight:800;margin-top:12px;color:var(--c)}
details{background:var(--card);border:1px solid var(--line);margin-bottom:8px}
summary{cursor:pointer;padding:12px 16px;font-weight:600}.notes{padding:0 16px 12px}
.why li{margin-bottom:6px}.why small{color:var(--mute)}
blockquote{margin:0;background:var(--terra-bg);padding:14px 16px;border-left:4px solid var(--terra)}
blockquote small{display:block;margin-top:6px;color:var(--mute)}
.muted{color:var(--mute)}
footer{margin-top:48px;color:var(--mute);font-size:12px;border-top:1px solid var(--line);padding-top:14px}
@media (max-width:640px){.bar{grid-template-columns:20px 1fr 40px}.bar .track,.bar em{display:none}h1{font-size:24px}.round{border-right:0;border-top:1px solid var(--line)}}
</style>
</head>
<body><div class="wrap">
<div class="top">${logo ? `<img src="${logo}" alt="">` : ""}GOAT<span>Rapport du conseil · ${esc(dateTxt)}</span></div>
<h1>${esc(council.title)}</h1>
<p class="sub">${esc(council.decision || "")} · Jurés : ${seatsAtTable.map((k) => esc(byKey[k].short)).join(", ")} · ${nRounds} tour${nRounds > 1 ? "s" : ""}</p>

<div class="verdict">
  ${verdict ? `<span class="label">${esc(VERDICT_FR[v.label] || v.label)}</span><p class="call">${esc(v.call)}</p>` : `<p class="call">Le conseil n'a pas encore rendu son verdict.</p>`}
  ${bars}
</div>

<h2>Qui a dit quoi, en un coup d'œil</h2>
<table><thead><tr><th>Juré</th><th>Pilier</th><th class="c">Poids</th><th>Tour 1 : son option préférée</th><th>Tour ${lastRound} : son option préférée</th><th class="c">A bougé</th></tr></thead><tbody>${glance}</tbody></table>

<h2>Qui a contredit qui</h2>
<div class="fights">${contradictions}</div>

${ruptures ? `<h2>Les points de rupture</h2>${ruptures}` : ""}

<h2>Ce que chaque juré a dit</h2>
${perSeat}

${verdict ? `<h2>Le verdict en détail</h2>${verdictBlock}` : ""}

${notes ? `<h2>Les notes du président</h2>${notes}` : ""}

<footer>Conseillers simulés, construits à partir du travail public de chaque personne. Ce ne sont pas ces personnes et ils ne parlent pas en leur nom. Les cartes complètes sont dans ${esc(path.basename(dir))}/round-*.md.</footer>
</div></body></html>`;

const out = path.join(dir, "rapport.html");
fs.writeFileSync(out, html);
console.log(out);
