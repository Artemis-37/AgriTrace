import { useState } from 'react';
import { download, get, post } from '../api';
import { Badge, ErrorBox, Field, Loading, Modal, useAction, useAsync } from '../ui';

export type QType = 'text' | 'number' | 'yesno' | 'choice' | 'multi' | 'date';
export type Question = { id: string; label: string; type: QType; options?: string[]; required: boolean };
export const QTYPE_FR: Record<QType, string> = { text: 'Texte', number: 'Nombre', yesno: 'Oui / Non', choice: 'Choix unique', multi: 'Choix multiple', date: 'Date' };
/** Affichage d'une réponse (tableau de choix, nombre, oui/non…). */
export const showAnswer = (v: any) => (v === undefined || v === null || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : v === 'oui' ? 'Oui' : v === 'non' ? 'Non' : String(v));


/** Le coach renseigne les réponses du producteur (ou consulte celles déjà saisies). */
export function AnswerForm({ targetId, onClose, onDone }: { targetId: string; onClose: () => void; onDone: () => void }) {
  const t = useAsync(() => get<any>(`/questionnaires/targets/${targetId}`), [targetId]);
  const [ans, setAns] = useState<Record<string, any>>({});
  const { busy, error, run } = useAction();
  const set = (id: string, v: any) => setAns((a) => ({ ...a, [id]: v }));
  const done = t.data?.status === 'done';
  const [cert, setCert] = useState('');
  const isInspection = String(t.data?.template_code ?? '').startsWith('ii-');
  const qs: Question[] = t.data?.questions ?? [];
  const missing = qs.some((q) => q.required && (ans[q.id] === undefined || ans[q.id] === '' || (Array.isArray(ans[q.id]) && !ans[q.id].length)));
  return (
    <Modal title={t.data ? `${t.data.title} · ${t.data.last_name} ${t.data.first_names}` : 'Questionnaire'} onClose={onClose}>
      {t.loading ? <Loading /> : t.error ? <ErrorBox message={t.error} onRetry={t.reload} /> : (
        <>
          <p className="muted">Producteur <code>{t.data.internal_code}</code>{t.data.instructions ? ` · ${t.data.instructions}` : ''}{done && <> · <Badge tone="ok">Renseigné</Badge></>}</p>
          {qs.map((q, i) => (
            <Field key={q.id} label={`${i + 1}. ${q.label}${q.required ? ' *' : ''}`}>
              {done ? <strong>{showAnswer(t.data.answers?.[q.id])}</strong>
                : q.type === 'text' ? <textarea rows={2} value={ans[q.id] ?? ''} onChange={(e) => set(q.id, e.target.value)} />
                : q.type === 'number' ? <input type="number" step="any" value={ans[q.id] ?? ''} onChange={(e) => set(q.id, e.target.value)} />
                : q.type === 'date' ? <input type="date" value={ans[q.id] ?? ''} onChange={(e) => set(q.id, e.target.value)} />
                : q.type === 'yesno' ? <span style={{ display: 'inline-flex', gap: '1rem' }}>{['oui', 'non'].map((v) => <label key={v}><input type="radio" name={q.id} checked={ans[q.id] === v} onChange={() => set(q.id, v)} /> {v === 'oui' ? 'Oui' : 'Non'}</label>)}</span>
                : q.type === 'choice' ? <select value={ans[q.id] ?? ''} onChange={(e) => set(q.id, e.target.value)}><option value="">—</option>{q.options!.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                : <span style={{ display: 'grid', gap: '.25rem' }}>{q.options!.map((o) => <label key={o}><input type="checkbox" checked={(ans[q.id] ?? []).includes(o)} onChange={(e) => set(q.id, e.target.checked ? [...(ans[q.id] ?? []), o] : (ans[q.id] ?? []).filter((x: string) => x !== o))} /> {o}</label>)}</span>}
            </Field>
          ))}
          {error && <ErrorBox message={error} />}
          <div className="modal-foot">{done && <span style={{ marginRight: 'auto', display: 'inline-flex', gap: '.5rem', alignItems: 'center' }}><select aria-label="Certification" value={cert} onChange={(e) => setCert(e.target.value)}><option value="">Certification de la fiche</option><option value="rainforest_alliance">Rainforest Alliance</option><option value="fairtrade">Fairtrade</option><option value="fairtrade_usa">Fairtrade USA</option></select><button className="btn btn-secondary" onClick={() => download(`/questionnaires/targets/${targetId}/export${cert ? `?certification=${cert}` : ''}`, `${isInspection ? 'inspection-interne' : 'fiche'}-${t.data.internal_code}.pdf`)}>Exporter (PDF)</button>{isInspection && <button className="btn btn-secondary" onClick={() => download(`/questionnaires/targets/${targetId}/export?format=docx${cert ? `&certification=${cert}` : ''}`, `inspection-interne-${t.data.internal_code}.docx`)}>Exporter (Word)</button>}</span>}<button className="btn btn-secondary" onClick={onClose}>{done ? 'Fermer' : 'Annuler'}</button>
            {!done && <button className="btn" disabled={busy || missing} onClick={() => run(async () => { await post(`/questionnaires/targets/${targetId}/answers`, { answers: ans }); onDone(); })}>{busy ? 'Enregistrement…' : 'Enregistrer les réponses'}</button>}</div>
        </>
      )}
    </Modal>
  );
}
