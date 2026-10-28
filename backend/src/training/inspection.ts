import { attachObservations } from './inspection-observations';
// Inspections internes : non-conformités relevées, score de conformité et approbation, calculés par le serveur à partir des réponses.
export const APPROVAL_THRESHOLD = 100; // % de conformité à partir duquel l'inspection est approuvée automatiquement

interface Q { id: string; label: string; type: string; options?: string[] }
export const isInspection = (templateCode?: string | null) => /^ii-/.test(templateCode ?? '');

const REQ = /^(\d+(?:\.\d+)+)\s*(EF|ES|EAC)?\s*[—–-]\s*([\s\S]*)$/;
export const findQuestion = (qs: Q[], re: RegExp) => qs.find((q) => re.test(q.label));

/** « 1.2.5 EF — texte » → { num: '1.2.5 EF', text: 'texte' } */
function describe(q: Q, index: number) {
  const m = REQ.exec(q.label.trim());
  const bare = q.label.replace(/^\[[^\]]*\]\s*/, '');
  const short = (s: string) => { const t = s.replace(/\s+/g, ' ').replace(/\*/g, '').trim(); return t.length > 200 ? t.slice(0, 197).trimEnd() + '…' : t; };
  return m ? { num: `${m[1]}${m[2] ? ' ' + m[2] : ''}`, text: short(m[3]) } : { num: `Q${index + 1}`, text: short(bare) };
}

const POS = new Set(['Conforme', 'Conformes', 'oui', 'Oui']);
const NEG = new Set(['Non conforme', 'Non conformes', 'non', 'Non', 'Partiels', 'Partielle', 'Insuffisant']);

/** Points de contrôle notés : exigences (Conforme / Non conforme) des fiches RA et points oui/non ou conforme/partiel des autres fiches (ceux qui ont une liste d'observations). */
export function evaluate(questions: Q[], answers: Record<string, any>) {
  let conform = 0, nonConform = 0, na = 0;
  const lines: string[] = [];
  attachObservations(questions as any).forEach((q: any, i: number) => {
    if (!q.observations) return;
    const a = answers?.[q.id];
    if (POS.has(a)) conform++;
    else if (a === 'Non applicable') na++;
    else if (NEG.has(a)) {
      nonConform++;
      const d = describe(q, i), obs = String(answers?.[`obs.${q.id}`] ?? '').trim();
      lines.push(REQ.test(q.label.trim()) ? `${d.num} — ${obs || d.text}` : `${d.text}${obs ? ' — ' + obs : ''}`);
    }
  });
  const score = conform + nonConform ? Math.round((conform / (conform + nonConform)) * 1000) / 10 : null;
  return { conform, nonConform, na, score, lines, text: lines.length ? lines.join('\n') : 'Aucune non-conformité relevée.' };
}

/** Points non conformes avec la mesure corrective choisie par le coach (à défaut, la première proposée), dans l'ordre de la fiche. */
export function correctiveItems(questions: Q[], answers: Record<string, any>) {
  const out: { id: string; num: string; measure: string }[] = [];
  attachObservations(questions as any).forEach((q: any, i: number) => {
    if (!q.measures?.length || !NEG.has(answers?.[q.id])) return;
    const d = describe(q, i);
    const chosen = String(answers?.[`mes.${q.id}`] ?? '').trim();
    out.push({ id: q.id, num: REQ.test(q.label.trim()) ? d.num : d.text.slice(0, 60), measure: chosen || q.measures[0] });
  });
  return out;
}

/** Renseigne automatiquement « Non-conformités relevées » et, si le score atteint le seuil, « Approuvé ». */
export function applyAuto(questions: Q[], answers: Record<string, any>) {
  const out = { ...answers };
  const ev = evaluate(questions, out);
  // Mesures correctives composées d'après les points non conformes (toutes les fiches d'inspection interne)
  const cq = findQuestion(questions, /^(Mesures correctives|Actions correctives demandées)/i);
  if (cq && cq.type === 'text') { const it = correctiveItems(questions, out); out[cq.id] = it.length ? it.map((x) => `${x.num} — ${x.measure}`).join('\n') : 'Aucune mesure corrective nécessaire.'; }
  if (ev.score === null) return { answers: out, ev, approved: null as boolean | null };
  const nc = findQuestion(questions, /^Non-conformités relevées/i);
  if (nc) out[nc.id] = ev.text;
  const dec = findQuestion(questions, /^(Recommandation de l.inspecteur|Résultat de l.inspection)/i);
  const approved = ev.score >= APPROVAL_THRESHOLD;
  if (dec) {
    const opts = dec.options ?? [];
    const yes = opts.find((o) => o === 'Approuvé') ?? opts.find((o) => /^Conforme/.test(o) && !/avec/.test(o));
    const no = opts.find((o) => /^Sanctionn/.test(o)) ?? opts.find((o) => /^Non/.test(o));
    if (approved && yes) out[dec.id] = yes;
    else if (!approved && no && (!out[dec.id] || out[dec.id] === yes)) out[dec.id] = no;
  }
  return { answers: out, ev, approved };
}
