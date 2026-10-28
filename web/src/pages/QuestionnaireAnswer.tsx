import { useState } from 'react';
import { download, get, post } from '../api';
import { Badge, ErrorBox, Field, Loading, Modal, useAction, useAsync } from '../ui';

export type QType = 'text' | 'number' | 'yesno' | 'choice' | 'multi' | 'date';
export type Question = { id: string; label: string; type: QType; options?: string[]; required: boolean; observations?: { C: string[]; NC: string[]; NA: string[] }; measures?: string[] };
export const QTYPE_FR: Record<QType, string> = { text: 'Texte', number: 'Nombre', yesno: 'Oui / Non', choice: 'Choix unique', multi: 'Choix multiple', date: 'Date' };
/** Affichage d'une réponse (tableau de choix, nombre, oui/non…). */
export const showAnswer = (v: any) => (v === undefined || v === null || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : v === 'oui' ? 'Oui' : v === 'non' ? 'Non' : String(v));


/** Le coach renseigne les réponses du producteur (ou consulte celles déjà saisies). */
export function AnswerForm({ targetId, onClose, onDone }: { targetId: string; onClose: () => void; onDone: () => void }) {
  const t = useAsync(() => get<any>(`/questionnaires/targets/${targetId}`), [targetId]);
  const [ans, setAns] = useState<Record<string, any>>({});
  const { busy, error, run } = useAction();
  const set = (id: string, v: any) => setAns((a) => { const n = { ...a, [id]: v }; if (!id.startsWith('obs.')) delete n[`obs.${id}`]; return n; });
  const done = t.data?.status === 'done';
  const [cert, setCert] = useState('');
  const isInspection = String(t.data?.template_code ?? '').startsWith('ii-');
  const qs: Question[] = t.data?.questions ?? [];
  const scored = qs.some((q) => q.options?.includes('Conforme') && q.options?.includes('Non conforme'));
  const auto = (q: Question) => (scored && /^(Non-conformités relevées|Recommandation de l.inspecteur|Croquis de l.exploitation)/i.test(q.label)) || (String(t.data?.template_code ?? '').startsWith('ii-') && /^(Mesures correctives|Actions correctives demandées)/i.test(q.label));
  const OBS: Record<string, 'C' | 'NC' | 'NA'> = { Conforme: 'C', Conformes: 'C', oui: 'C', Oui: 'C', 'Non conforme': 'NC', 'Non conformes': 'NC', non: 'NC', Non: 'NC', Partiels: 'NC', Partielle: 'NC', Insuffisant: 'NC', 'Non applicable': 'NA' };
  const missing = qs.some((q) => q.required && !auto(q) && (ans[q.id] === undefined || ans[q.id] === '' || (Array.isArray(ans[q.id]) && !ans[q.id].length)));
  return (
    <Modal title={t.data ? `${t.data.title} · ${t.data.last_name} ${t.data.first_names}` : 'Questionnaire'} onClose={onClose}>
      {t.loading ? <Loading /> : t.error ? <ErrorBox message={t.error} onRetry={t.reload} /> : (
        <>
          <p className="muted">Producteur <code>{t.data.internal_code}</code>{t.data.instructions ? ` · ${t.data.instructions}` : ''}{done && <> · <Badge tone="ok">Renseigné</Badge></>}</p>
          {qs.map((q, i) => (
            auto(q) ? <Field key={q.id} label={`${i + 1}. ${q.label}`}><span className="muted">{done ? showAnswer(t.data.answers?.[q.id]) : 'Renseigné automatiquement d\'après les réponses (mesures correctives selon les points non conformes ; approbation à 75 % ; croquis à l\'export).'}</span></Field> :
            <Field key={q.id} label={`${i + 1}. ${q.label}${q.required ? ' *' : ''}`}>
              {done ? <strong>{showAnswer(t.data.answers?.[q.id])}</strong>
                : q.type === 'text' ? <textarea rows={2} value={ans[q.id] ?? ''} onChange={(e) => set(q.id, e.target.value)} />
                : q.type === 'number' ? <input type="number" step="any" value={ans[q.id] ?? ''} onChange={(e) => set(q.id, e.target.value)} />
                : q.type === 'date' ? <input type="date" value={ans[q.id] ?? ''} onChange={(e) => set(q.id, e.target.value)} />
                : q.type === 'yesno' ? <span style={{ display: 'inline-flex', gap: '1rem' }}>{['oui', 'non'].map((v) => <label key={v}><input type="radio" name={q.id} checked={ans[q.id] === v} onChange={() => set(q.id, v)} /> {v === 'oui' ? 'Oui' : 'Non'}</label>)}</span>
                : q.type === 'choice' ? <select value={ans[q.id] ?? ''} onChange={(e) => set(q.id, e.target.value)}><option value="">—</option>{q.options!.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                : <span style={{ display: 'grid', gap: '.25rem' }}>{q.options!.map((o) => <label key={o}><input type="checkbox" checked={(ans[q.id] ?? []).includes(o)} onChange={(e) => set(q.id, e.target.checked ? [...(ans[q.id] ?? []), o] : (ans[q.id] ?? []).filter((x: string) => x !== o))} /> {o}</label>)}</span>}
              {q.observations && (() => {
                const k = OBS[String(done ? t.data.answers?.[q.id] : ans[q.id])];
                if (!k) return null;
                if (done) { const o = t.data.answers?.[`obs.${q.id}`], mm = t.data.answers?.[`mes.${q.id}`]; return o || mm ? <p className="muted" style={{ margin: '.3rem 0 0' }}>{o ? `Observation : ${o}` : ''}{o && mm ? ' · ' : ''}{mm ? `Mesure : ${mm}` : ''}</p> : null; }
                const NEGS = ['NC'];
                const list = q.observations[k], curM = ans[`mes.${q.id}`] as string | undefined, ms = q.measures ?? [], customM = curM !== undefined && !ms.includes(curM), cur = ans[`obs.${q.id}`] as string | undefined, custom = cur !== undefined && !list.includes(cur);
                return (<div style={{ marginTop: '.4rem', display: 'grid', gap: '.3rem' }}>
                  <select aria-label={`Observation ${i + 1}`} value={custom ? '__autre' : cur ?? ''} onChange={(e) => set(`obs.${q.id}`, e.target.value === '__autre' ? ' ' : e.target.value)}>
                    <option value="">Observation…</option>{list.map((o) => <option key={o} value={o}>{o}</option>)}<option value="__autre">Autre (saisir)…</option></select>
                  {custom && <input aria-label="Observation saisie" value={cur!.trim() === '' ? '' : cur} placeholder="Saisissez l'observation" onChange={(e) => set(`obs.${q.id}`, e.target.value || ' ')} />}
                  {NEGS.includes(k) && ms.length > 0 && <>
                    <select aria-label={`Mesure corrective ${i + 1}`} value={customM ? '__autre' : curM ?? ''} onChange={(e) => set(`mes.${q.id}`, e.target.value === '__autre' ? ' ' : e.target.value)}>
                      <option value="">{`Mesure corrective (à défaut : ${ms[0]})`}</option>{ms.map((o) => <option key={o} value={o}>{o}</option>)}<option value="__autre">Autre (saisir)…</option></select>
                    {customM && <input aria-label="Mesure corrective saisie" value={curM!.trim() === '' ? '' : curM} placeholder="Saisissez la mesure corrective" onChange={(e) => set(`mes.${q.id}`, e.target.value || ' ')} />}
                  </>}
                </div>);
              })()}
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
