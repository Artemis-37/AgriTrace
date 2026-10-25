import { useState } from 'react';
import { get, post } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, ErrorBox, Field, Loading, Modal, Table, useAction, useAsync } from '../ui';

export const KIND_LABEL: Record<string, string> = { formation: 'Module de formation', distribution: 'Distribution', tache: 'Tâche' };
const d = (x: string | null) => (x ? new Date(x).toLocaleDateString('fr-FR') : '—');
type P = { id: string; internal_code: string; last_name: string; first_names: string; section: string | null; village: string | null };
type Item = { target_id: string; status: 'pending' | 'done'; done_at: string | null; id: string; kind: string; title: string; instructions: string; due_date: string | null; created_at: string };
type Row = { id: string; kind: string; scope: string; title: string; due_date: string | null; created_at: string; targets: number; done: number };

/**
 * Nature (module de formation, distribution ou tâche) et cible (tous les producteurs ou certains) d'un élément que l'ADG envoie aux coachs.
 * Sert à la transmission d'un module d'exportateur (`forwardUrl`) et à l'affectation d'un modèle de la bibliothèque (`moduleId` / titre libre).
 */
export function AssignDialog({ title, forwardUrl, modules, producer, onClose, onDone }: { title: string; forwardUrl?: string; modules?: { id: string; title: string }[]; producer?: { id: string }; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState('formation');
  const [scope, setScope] = useState<'all' | 'selected'>(producer ? 'selected' : 'all');
  const [sel, setSel] = useState<string[]>(producer ? [producer.id] : []);
  const [q, setQ] = useState(''); const [section, setSection] = useState('');
  const [due, setDue] = useState(''); const [instr, setInstr] = useState('');
  const [moduleId, setModuleId] = useState(''); const [free, setFree] = useState('');
  const act = useAction();
  const sections = useAsync(() => get<{ section: string; producers: number }[]>('/producers/sections').catch(() => []), []);
  const prods = useAsync(() => scope === 'selected' ? get<P[]>(`/producers?limit=100${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}${section ? `&section=${encodeURIComponent(section)}` : ''}`) : Promise.resolve([] as P[]), [scope, q, section]);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const lib = !forwardUrl;
  const needModule = lib && kind === 'formation';
  const ready = (scope === 'all' || sel.length > 0) && (!needModule || moduleId) && (!lib || kind === 'formation' || free.trim().length >= 3);
  const submit = () => act.run(async () => {
    const body: Record<string, unknown> = { kind, scope, ...(scope === 'selected' ? { producer_ids: sel } : {}), ...(due ? { due_date: due } : {}), ...(instr.trim() ? { instructions: instr.trim() } : {}) };
    if (lib) { if (needModule) body.module_id = moduleId; else body.title = free.trim(); }
    await post(forwardUrl ?? '/producer-assignments', body); onDone();
  });
  return (
    <Modal title={title} onClose={onClose}>
      <div className="form-grid">
        <Field label="Nature de l'élément">
          <select aria-label="Nature" value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        {needModule && (
          <Field label="Modèle de la bibliothèque">
            <select aria-label="Modèle" value={moduleId} onChange={(e) => setModuleId(e.target.value)}><option value="">Choisir un module…</option>{(modules ?? []).map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select>
          </Field>
        )}
        {needModule && !(modules ?? []).length && <p className="muted" style={{ gridColumn: '1 / -1', margin: 0 }}>La bibliothèque ne contient aucun module : créez-en un dans « Modules de formation », ou choisissez « Distribution » ou « Tâche ».</p>}
        {lib && kind !== 'formation' && <Field label="Intitulé"><input value={free} onChange={(e) => setFree(e.target.value)} placeholder={kind === 'distribution' ? 'Ex. Distribution de plants' : 'Ex. Mettre à jour le carnet de récolte'} /></Field>}
        {!producer && <Field label="Producteurs concernés">
          <select aria-label="Cible" value={scope} onChange={(e) => setScope(e.target.value as 'all' | 'selected')}>
            <option value="all">Tous les producteurs</option><option value="selected">Certains producteurs</option>
          </select>
        </Field>}
        <Field label="Échéance (facultatif)"><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      </div>
      {scope === 'selected' && !producer && (
        <>
          <div className="toolbar">
            <input type="search" aria-label="Rechercher un producteur" placeholder="Rechercher (nom, code)" value={q} onChange={(e) => setQ(e.target.value)} />
            <select aria-label="Section" value={section} onChange={(e) => setSection(e.target.value)}><option value="">Toutes les sections</option>{(sections.data ?? []).map((s) => <option key={s.section} value={s.section}>{s.section}</option>)}</select>
            {(prods.data ?? []).length > 0 && <button type="button" className="btn btn-ghost btn-small" onClick={() => setSel((s) => [...new Set([...s, ...(prods.data ?? []).map((p) => p.id)])])}>Tout cocher (liste)</button>}
            <strong>{sel.length} choisi(s)</strong>
          </div>
          <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border, #ddd)', borderRadius: 8, padding: 6 }}>
            {prods.loading ? <Loading /> : (prods.data ?? []).map((p) => (
              <label key={p.id} style={{ display: 'flex', gap: 8, padding: '3px 4px' }}><input type="checkbox" checked={sel.includes(p.id)} onChange={() => toggle(p.id)} /> {p.internal_code} · {p.last_name} {p.first_names} <span className="muted">{p.section ?? ''}</span></label>
            ))}
          </div>
        </>
      )}
      <Field label="Consigne pour les coachs (facultatif)"><textarea rows={2} value={instr} onChange={(e) => setInstr(e.target.value)} /></Field>
      {act.error && <ErrorBox message={act.error} />}
      <p className="muted" style={{ marginBottom: 0 }}>{producer ? 'S\'ajoutera au profil de ce producteur ; les coachs le recevront à la prochaine synchronisation.' : scope === 'all' ? 'S\'ajoutera au profil de tous les producteurs actifs.' : `S'ajoutera au profil de ${sel.length} producteur(s).`}{forwardUrl ? ' Le contenu du module reste celui de l\'exportateur, sans modification.' : ''}</p>
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Annuler</button><button className="btn" disabled={act.busy || !ready} onClick={submit}>{forwardUrl ? 'Transmettre aux coachs' : 'Affecter'}</button></div>
    </Modal>
  );
}

/** Profil d'un producteur : éléments (formations, distributions, tâches) ajoutés par l'ADG. */
export function ProducerProfile({ p, onClose }: { p: P; onClose: () => void }) {
  const { can } = useAuth();
  const act = useAction();
  const items = useAsync(() => get<Item[]>(`/producer-assignments?producer_id=${p.id}`), [p.id]);
  const canDone = can('training:report') || can('training:assign');
  const mods = useAsync(() => (can('training:assign') ? get<{ id: string; title: string }[]>('/training-modules').catch(() => []) : Promise.resolve([] as { id: string; title: string }[])), []);
  const [adding, setAdding] = useState(false);
  return (
    <Modal title={`${p.last_name} ${p.first_names} · ${p.internal_code}`} onClose={onClose}>
      <p className="muted">{[p.village, p.section && `section ${p.section}`].filter(Boolean).join(' · ') || '—'}</p>
      <h3 style={{ marginTop: 0 }}>Formations, distributions et tâches</h3>
      {act.error && <ErrorBox message={act.error} />}
      {items.loading ? <Loading /> : items.error ? <ErrorBox message={items.error} onRetry={items.reload} /> : (
        <Table rows={items.data ?? []} empty="Rien n'a encore été ajouté à ce profil." columns={[
          { header: 'Nature', render: (i: Item) => <Badge tone="neutral">{KIND_LABEL[i.kind]}</Badge> },
          { header: 'Élément', render: (i: Item) => <><strong>{i.title}</strong>{i.instructions && <div className="muted" style={{ fontSize: '.85rem' }}>{i.instructions}</div>}</> },
          { header: 'Échéance', render: (i: Item) => d(i.due_date) },
          { header: 'État', render: (i: Item) => i.status === 'done' ? <Badge tone="ok">Fait le {d(i.done_at)}</Badge> : canDone ? <button className="btn btn-small" disabled={act.busy} onClick={() => act.run(async () => { await post(`/producer-assignments/targets/${i.target_id}/done`); items.reload(); })}>Marquer fait</button> : <Badge tone="warn">À faire</Badge> },
        ]} />
      )}
      {adding && <AssignDialog title={`Envoyer aux coachs : ${p.last_name} ${p.first_names}`} modules={mods.data ?? []} producer={p} onClose={() => setAdding(false)} onDone={() => { setAdding(false); items.reload(); }} />}
      <div className="modal-foot">{can('training:assign') && <button className="btn" onClick={() => setAdding(true)}>Envoyer une formation, distribution ou tâche aux coachs</button>}<button className="btn btn-secondary" onClick={onClose}>Fermer</button></div>
    </Modal>
  );
}

/** Onglet « Affectations » de l'ADG : ce qui a été envoyé, à combien de producteurs, et l'avancement. */
export function AssignmentsTab() {
  const rows = useAsync(() => get<Row[]>('/producer-assignments'), []);
  const mods = useAsync(() => get<{ id: string; title: string }[]>('/training-modules'), []);
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <div className="toolbar"><button className="btn" onClick={() => setOpen(true)}>Affecter un modèle</button><span className="muted">Choisissez la nature (formation, distribution, tâche) puis tous les producteurs ou certains.</span></div>
      {rows.loading ? <Loading /> : rows.error ? <ErrorBox message={rows.error} onRetry={rows.reload} /> : (
        <Table rows={rows.data ?? []} empty="Aucune affectation pour le moment." columns={[
          { header: 'Date', render: (r: Row) => d(r.created_at) },
          { header: 'Nature', render: (r: Row) => <Badge tone="neutral">{KIND_LABEL[r.kind]}</Badge> },
          { header: 'Élément', render: (r: Row) => <strong>{r.title}</strong> },
          { header: 'Cible', render: (r: Row) => r.scope === 'all' ? `Tous les producteurs (${r.targets})` : `${r.targets} producteur(s)` },
          { header: 'Échéance', render: (r: Row) => d(r.due_date) },
          { header: 'Avancement', render: (r: Row) => `${r.done} / ${r.targets} fait(s)` },
        ]} />
      )}
      {open && <AssignDialog title="Affecter un modèle aux producteurs" modules={mods.data ?? []} onClose={() => setOpen(false)} onDone={() => { setOpen(false); rows.reload(); }} />}
    </Card>
  );
}
