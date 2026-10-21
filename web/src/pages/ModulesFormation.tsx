import { FormEvent, useState } from 'react';
import { del, get, post, put } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, ErrorBox, Field, Loading, Modal, PageHeader, useAction, useAsync } from '../ui';

type Content = { objectifs: string[]; sections: { titre: string; points: string[] }[]; a_eviter: string[]; verifier: string[]; materiel: string[] };
type Mod = { id: string; code: string | null; theme: string; title: string; summary: string; crops: string[]; certifications: string[]; level: string; duration_min: number; content: Content; review_state: string; version: number; reviewed_by_name: string | null; reviewed_at: string | null };

const CROP: Record<string, string> = { cacao: 'Cacao', cafe: 'Café' };
const LEVEL: Record<string, string> = { base: 'Base', intermediaire: 'Intermédiaire', avance: 'Avancé' };
const STATE: Record<string, ['neutral' | 'ok' | 'warn' | 'info', string]> = { to_review: ['warn', 'À relire par l\'ADG'], kept: ['ok', 'Conservé'], edited: ['info', 'Modifié'], custom: ['info', 'Ajouté par la coopérative'] };
const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean);

/** Bibliothèque de modules de formation agricole (cacao puis café) : consultée par les coachs, relue et adaptée par l'ADG. */
export default function ModulesFormation() {
  const { can } = useAuth();
  const manage = can('training:manage');
  const [crop, setCrop] = useState('');
  const [theme, setTheme] = useState('');
  const [cert, setCert] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Mod | null>(null);
  const [edit, setEdit] = useState<Mod | 'new' | null>(null);
  const act = useAction();
  const { data, loading, error, reload } = useAsync(() => get<Mod[]>('/training-modules'), []);
  const all = data ?? [];
  const themes = [...new Set(all.map((m) => m.theme))].sort();
  const certs = [...new Set(all.flatMap((m) => m.certifications))].sort();
  const rows = all.filter((m) => (!crop || m.crops.includes(crop)) && (!theme || m.theme === theme) && (!cert || m.certifications.includes(cert))
    && (!q.trim() || `${m.title} ${m.summary}`.toLowerCase().includes(q.trim().toLowerCase())));
  const toReview = all.filter((m) => m.review_state === 'to_review').length;

  return (
    <>
      <PageHeader title="Modules de formation" subtitle="Formations agricoles liées aux certifications du cacao (et du café) : consultation par les coachs, relecture par l'ADG"
        actions={manage && <button className="btn" onClick={() => setEdit('new')}>Nouveau module</button>} />
      {manage && toReview > 0 && (
        <p className="notice" role="status">{toReview} module(s) chargé(s) par défaut n'ont pas encore été relus. Pour chacun : <strong>Conserver</strong> (tel quel), <strong>Modifier</strong> ou <strong>Supprimer</strong>.
          {' '}Le contenu de départ est général : adaptez-le au cahier des charges de la certification visée et à la réglementation en vigueur.</p>
      )}
      <Card>
        <div className="toolbar">
          <input type="search" aria-label="Rechercher un module" placeholder="Rechercher un module" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} />
          <select aria-label="Culture" value={crop} onChange={(e) => setCrop(e.target.value)}><option value="">Cacao et café</option><option value="cacao">Cacao</option><option value="cafe">Café</option></select>
          <select aria-label="Thème" value={theme} onChange={(e) => setTheme(e.target.value)}><option value="">Tous les thèmes</option>{themes.map((t) => <option key={t}>{t}</option>)}</select>
          <select aria-label="Certification" value={cert} onChange={(e) => setCert(e.target.value)}><option value="">Toutes les certifications</option>{certs.map((t) => <option key={t}>{t}</option>)}</select>
          {manage && <button className="btn btn-ghost btn-small" disabled={act.busy} onClick={() => act.run(async () => { const r = await post('/training-modules/restore-defaults'); alert(r.restored ? `${r.restored} module(s) par défaut rechargé(s).` : 'Aucun module par défaut ne manque.'); reload(); })}>Recharger les modules supprimés</button>}
        </div>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {act.error && <ErrorBox message={act.error} />}
        {loading ? <Loading /> : !rows.length ? <p className="empty">Aucun module ne correspond.</p> : (
          <ul className="plain" style={{ display: 'grid', gap: '.75rem', listStyle: 'none', padding: 0, margin: 0 }}>
            {rows.map((m) => (
              <li key={m.id} className="card" style={{ padding: '.9rem 1rem' }}>
                <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <button className="btn btn-ghost" style={{ fontWeight: 700, textAlign: 'left' }} onClick={() => setOpen(m)}>{m.title}</button>
                  {manage && <Badge tone={STATE[m.review_state]?.[0] ?? 'neutral'}>{STATE[m.review_state]?.[1] ?? m.review_state}</Badge>}
                </div>
                <p className="muted" style={{ margin: '.2rem 0' }}>{m.summary}</p>
                <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>{m.theme} · {m.crops.map((c) => CROP[c] ?? c).join(', ')} · {LEVEL[m.level]} · {m.duration_min} min{m.certifications.length ? ` · ${m.certifications.join(', ')}` : ''}</p>
                {manage && (
                  <div className="row-actions" style={{ marginTop: '.5rem' }}>
                    {m.review_state === 'to_review' && <button className="btn btn-small" disabled={act.busy} onClick={() => act.run(async () => { await post(`/training-modules/${m.id}/keep`); reload(); })}>Conserver</button>}
                    <button className="btn btn-small btn-secondary" onClick={() => setEdit(m)}>Modifier</button>
                    <button className="btn btn-small btn-secondary" disabled={act.busy} onClick={() => { if (confirm(`Supprimer le module « ${m.title} » ? Les coachs ne le verront plus.`)) act.run(async () => { await del(`/training-modules/${m.id}`); reload(); }); }}>Supprimer</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {open && <Reader m={open} onClose={() => setOpen(null)} />}
      {edit && <Editor m={edit === 'new' ? null : edit} themes={themes} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function Reader({ m, onClose }: { m: Mod; onClose: () => void }) {
  const c = m.content;
  return (
    <Modal title={m.title} onClose={onClose}>
      <p className="muted">{m.theme} · {m.crops.map((x) => CROP[x] ?? x).join(', ')} · {LEVEL[m.level]} · {m.duration_min} min{m.certifications.length ? ` · ${m.certifications.join(', ')}` : ''}</p>
      <p>{m.summary}</p>
      <h4>Objectifs</h4><ul>{c.objectifs.map((o, i) => <li key={i}>{o}</li>)}</ul>
      {c.sections.map((s, i) => <div key={i}><h4>{s.titre}</h4><ul>{s.points.map((p, j) => <li key={j}>{p}</li>)}</ul></div>)}
      {c.a_eviter.length > 0 && <><h4>À éviter</h4><ul>{c.a_eviter.map((o, i) => <li key={i}>{o}</li>)}</ul></>}
      {c.verifier.length > 0 && <><h4>Questions pour vérifier la compréhension</h4><ul>{c.verifier.map((o, i) => <li key={i}>{o}</li>)}</ul></>}
      {c.materiel.length > 0 && <><h4>Matériel</h4><ul>{c.materiel.map((o, i) => <li key={i}>{o}</li>)}</ul></>}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Fermer</button></div>
    </Modal>
  );
}

function Editor({ m, themes, onClose, onDone }: { m: Mod | null; themes: string[]; onClose: () => void; onDone: () => void }) {
  const act = useAction();
  const [f, setF] = useState({
    title: m?.title ?? '', theme: m?.theme ?? themes[0] ?? '', summary: m?.summary ?? '', crops: m?.crops ?? ['cacao'], certs: (m?.certifications ?? []).join(', '),
    level: m?.level ?? 'base', duration: String(m?.duration_min ?? 45),
    objectifs: (m?.content.objectifs ?? []).join('\n'), sections: m?.content.sections ?? [{ titre: '', points: [''] }],
    a_eviter: (m?.content.a_eviter ?? []).join('\n'), verifier: (m?.content.verifier ?? []).join('\n'), materiel: (m?.content.materiel ?? []).join('\n'),
  });
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const setSection = (i: number, patch: Partial<{ titre: string; points: string[] }>) => setF({ ...f, sections: f.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const body = () => ({
    theme: f.theme.trim(), title: f.title.trim(), summary: f.summary.trim(), crops: f.crops, certifications: f.certs.split(',').map((x) => x.trim()).filter(Boolean), level: f.level, duration_min: Number(f.duration) || 45,
    content: { objectifs: lines(f.objectifs), sections: f.sections.map((s) => ({ titre: s.titre.trim(), points: s.points.map((p) => p.trim()).filter(Boolean) })).filter((s) => s.titre && s.points.length), a_eviter: lines(f.a_eviter), verifier: lines(f.verifier), materiel: lines(f.materiel) },
  });
  const valid = f.title.trim().length >= 3 && f.theme.trim() && f.crops.length > 0 && lines(f.objectifs).length > 0 && f.sections.some((s) => s.titre.trim() && s.points.some((p) => p.trim()));
  const submit = (e: FormEvent) => { e.preventDefault(); act.run(async () => { if (m) await put(`/training-modules/${m.id}`, body()); else await post('/training-modules', body()); onDone(); }); };
  return (
    <Modal title={m ? 'Modifier le module' : 'Nouveau module'} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Titre"><input value={f.title} onChange={set('title')} maxLength={200} /></Field>
        <Field label="Thème" hint="Un thème existant ou un nouveau."><input list="themes-formation" value={f.theme} onChange={set('theme')} maxLength={120} /></Field>
        <datalist id="themes-formation">{themes.map((t) => <option key={t} value={t} />)}</datalist>
        <Field label="Résumé"><textarea rows={2} value={f.summary} onChange={set('summary')} maxLength={1000} /></Field>
        <fieldset className="field"><legend>Cultures</legend>
          {Object.entries(CROP).map(([k, v]) => <label key={k} style={{ marginRight: '1rem' }}><input type="checkbox" checked={f.crops.includes(k)} onChange={() => setF({ ...f, crops: f.crops.includes(k) ? f.crops.filter((x) => x !== k) : [...f.crops, k] })} /> {v}</label>)}
        </fieldset>
        <Field label="Certifications concernées" hint="Séparées par des virgules (ex. Rainforest Alliance, Fairtrade, EUDR)."><input value={f.certs} onChange={set('certs')} /></Field>
        <Field label="Niveau"><select value={f.level} onChange={set('level')}>{Object.entries(LEVEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Durée (minutes)"><input inputMode="numeric" value={f.duration} onChange={set('duration')} /></Field>
        <Field label="Objectifs pédagogiques" hint="Un par ligne."><textarea rows={3} value={f.objectifs} onChange={set('objectifs')} /></Field>
        {f.sections.map((s, i) => (
          <fieldset key={i} className="field"><legend>Section {i + 1}</legend>
            <input aria-label={`Titre de la section ${i + 1}`} placeholder="Titre de la section" value={s.titre} onChange={(e) => setSection(i, { titre: e.target.value })} />
            <textarea aria-label={`Points de la section ${i + 1}`} rows={4} placeholder="Un point par ligne" value={s.points.join('\n')} onChange={(e) => setSection(i, { points: e.target.value.split('\n') })} />
            {f.sections.length > 1 && <button type="button" className="btn btn-ghost btn-small" onClick={() => setF({ ...f, sections: f.sections.filter((_, j) => j !== i) })}>Retirer cette section</button>}
          </fieldset>
        ))}
        <button type="button" className="btn btn-secondary btn-small" onClick={() => setF({ ...f, sections: [...f.sections, { titre: '', points: [''] }] })}>Ajouter une section</button>
        <Field label="À éviter" hint="Un par ligne."><textarea rows={3} value={f.a_eviter} onChange={set('a_eviter')} /></Field>
        <Field label="Questions de vérification" hint="Un par ligne : le coach les pose aux producteurs pour contrôler la compréhension."><textarea rows={3} value={f.verifier} onChange={set('verifier')} /></Field>
        <Field label="Matériel" hint="Un par ligne."><textarea rows={2} value={f.materiel} onChange={set('materiel')} /></Field>
        {act.error && <ErrorBox message={act.error} />}
        <div className="modal-foot"><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button className="btn" disabled={act.busy || !valid}>{act.busy ? 'Enregistrement…' : 'Enregistrer'}</button></div>
      </form>
    </Modal>
  );
}
