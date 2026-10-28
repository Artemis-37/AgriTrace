// Inspections internes : non-conformités relevées, score de conformité et approbation, calculés par le serveur à partir des réponses.
export const APPROVAL_THRESHOLD = 75; // % de conformité à partir duquel l'inspection est approuvée automatiquement

interface Q { id: string; label: string; type: string; options?: string[] }
export const isInspection = (templateCode?: string | null) => /^ii-/.test(templateCode ?? '');

const REQ = /^(\d+(?:\.\d+)+)\s*(EF|ES|EAC)?\s*[—–-]\s*([\s\S]*)$/;
const evaluable = (q: Q) => q.type === 'choice' && !!q.options?.includes('Conforme') && !!q.options?.includes('Non conforme');
export const findQuestion = (qs: Q[], re: RegExp) => qs.find((q) => re.test(q.label));

/** « 1.2.5 EF — texte » → { num: '1.2.5 EF', text: 'texte' } */
function describe(q: Q, index: number) {
  const m = REQ.exec(q.label.trim());
  const short = (s: string) => { const t = s.replace(/\s+/g, ' ').replace(/\*/g, '').trim(); return t.length > 200 ? t.slice(0, 197).trimEnd() + '…' : t; };
  return m ? { num: `${m[1]}${m[2] ? ' ' + m[2] : ''}`, text: short(m[3]) } : { num: `Q${index + 1}`, text: short(q.label) };
}

export function evaluate(questions: Q[], answers: Record<string, any>) {
  let conform = 0, nonConform = 0, na = 0;
  const lines: string[] = [];
  questions.forEach((q, i) => {
    if (!evaluable(q)) return;
    const a = answers?.[q.id];
    if (a === 'Conforme') conform++;
    else if (a === 'Non applicable') na++;
    else if (a === 'Non conforme') { nonConform++; const d = describe(q, i); const obs = String(answers?.[`obs.${q.id}`] ?? '').trim(); lines.push(`${d.num} — ${obs || d.text}`); }
  });
  const score = conform + nonConform ? Math.round((conform / (conform + nonConform)) * 1000) / 10 : null;
  return { conform, nonConform, na, score, lines, text: lines.length ? lines.join('\n') : 'Aucune non-conformité relevée.' };
}

/** Renseigne automatiquement « Non-conformités relevées » et, si le score atteint le seuil, « Approuvé ». */
export function applyAuto(questions: Q[], answers: Record<string, any>) {
  const out = { ...answers };
  const ev = evaluate(questions, out);
  if (ev.score === null) return { answers: out, ev, approved: null as boolean | null };
  const nc = findQuestion(questions, /^Non-conformités relevées/i);
  if (nc) out[nc.id] = ev.text;
  const dec = findQuestion(questions, /^Recommandation de l.inspecteur/i);
  const approved = ev.score >= APPROVAL_THRESHOLD;
  if (dec) {
    if (approved && dec.options?.includes('Approuvé')) out[dec.id] = 'Approuvé';
    else if (!approved && (!out[dec.id] || out[dec.id] === 'Approuvé')) out[dec.id] = dec.options?.find((o) => /^Sanctionn/.test(o)) ?? out[dec.id];
  }
  return { answers: out, ev, approved };
}
