import { FormEvent, useEffect, useState } from 'react';
import { get, post } from '../api';
import { useAuth } from '../auth';
import { PRODUCER_STATUS } from '../format';
import { Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, StatusBadge, Table, useAction, useAsync } from '../ui';

export default function Producers() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [section, setSection] = useState('');
  const [limit, setLimit] = useState(100);
  useEffect(() => { const t = setTimeout(() => { setQd(q.trim()); setLimit(100); }, 250); return () => clearTimeout(t); }, [q]);
  const sections = useAsync(() => get<{ section: string; producers: number }[]>('/producers/sections').catch(() => []), []);
  const [creating, setCreating] = useState(false);
  const [chg, setChg] = useState<any | null>(null);
  // Recherche et filtre par section faits par le serveur (toute la liste, pas seulement les premiers producteurs).
  const { data, loading, error, reload } = useAsync(
    () => get<any[]>(`/producers?limit=${limit}${qd ? `&q=${encodeURIComponent(qd)}` : ''}${section ? `&section=${encodeURIComponent(section)}` : ''}`), [qd, section, limit]);
  const rows = data ?? [];
  return (
    <>
      <PageHeader title="Producteurs" subtitle="Registre des producteurs de la coopérative"
        actions={can('producers:create') && <button className="btn" onClick={() => setCreating(true)}>Nouveau producteur</button>} />
      <Card>
        <div className="toolbar">
          <input type="search" aria-label="Rechercher" placeholder="Rechercher (nom, code, téléphone)" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 300 }} />
          <select aria-label="Filtrer par section" value={section} onChange={(e) => { setSection(e.target.value); setLimit(100); }}>
            <option value="">Toutes les sections</option>
            {(sections.data ?? []).map((s) => <option key={s.section} value={s.section}>{s.section} ({s.producers})</option>)}
          </select>
          {(section || q) && <button className="btn btn-ghost btn-small" onClick={() => { setQ(''); setSection(''); }}>Effacer les filtres</button>}
        </div>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {loading ? <Loading /> : (
          <Table rows={rows} empty="Aucun producteur trouvé." columns={[
            { header: 'Code', render: (p) => p.internal_code },
            { header: 'Nom', render: (p) => <strong>{p.last_name} {p.first_names}</strong> },
            { header: 'Village', render: (p) => p.village ?? '—' },
            { header: 'Section', render: (p) => p.section ?? '—' },
            { header: 'Téléphone', render: (p) => p.phone ?? '—' },
            { header: 'Statut', render: (p) => <StatusBadge map={PRODUCER_STATUS} value={p.status} /> },
            { header: '', render: (p) => can('producers:status') && p.status !== 'archived' && <button className="btn btn-small btn-secondary" onClick={() => setChg(p)}>Statut</button> },
          ]} />
        )}
        {!loading && rows.length >= limit && <div className="toolbar"><button className="btn btn-secondary" onClick={() => setLimit(limit + 100)}>Afficher plus de producteurs</button></div>}
      </Card>
      {chg && <ChangeStatus p={chg} onClose={() => setChg(null)} onDone={() => { setChg(null); reload(); }} />}
      {creating && <NewProducer onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />}
    </>
  );
}

function NewProducer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const chains = useAsync(() => get<any[]>('/value-chains'), []);
  const [f, setF] = useState({ last_name: '', first_names: '', phone: '', village: '', section: '', chain: '' });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await post('/producers', {
        last_name: f.last_name.trim(), first_names: f.first_names.trim(),
        ...(f.phone.trim() && { phone: f.phone.trim() }), ...(f.village.trim() && { village: f.village.trim() }), ...(f.section.trim() && { section: f.section.trim() }),
        ...(f.chain && { value_chain_ids: [f.chain] }),
      });
      onDone();
    });
  };
  return (
    <Modal title="Nouveau producteur" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Nom"><input required value={f.last_name} onChange={set('last_name')} /></Field>
        <Field label="Prénoms"><input required value={f.first_names} onChange={set('first_names')} /></Field>
        <Field label="Téléphone" hint="Format international, par exemple +2250701020304"><input inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Village"><input value={f.village} onChange={set('village')} /></Field>
        <Field label="Section"><input value={f.section} onChange={set('section')} /></Field>
        <Field label="Filière">
          <select value={f.chain} onChange={set('chain')}><option value="">— Aucune —</option>{(chains.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </Field>
        {chains.data && !chains.data.length && <Empty>Aucune filière définie.</Empty>}
        {error && <ErrorBox message={error} />}
        <div className="modal-foot"><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button className="btn" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button></div>
      </form>
    </Modal>
  );
}

function ChangeStatus({ p, onClose, onDone }: { p: any; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const hist = useAsync(() => get<any[]>(`/producers/${p.id}/status-history`).catch(() => []), [p.id]);
  const { busy, error, run } = useAction();
  return (
    <Modal title={`Statut de ${p.last_name} ${p.first_names}`} onClose={onClose}>
      <p>Statut actuel : <StatusBadge map={PRODUCER_STATUS} value={p.status} /></p>
      <Field label="Nouveau statut"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">—</option>{Object.entries(PRODUCER_STATUS).filter(([k]) => k !== p.status && k !== 'creating').map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Motif"><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {error && <ErrorBox message={error} />}
      {(hist.data ?? []).length > 0 && <><h3>Historique</h3><ul>{hist.data!.map((h: any) => <li key={h.id}>{new Date(h.created_at).toLocaleDateString('fr-FR')} : {h.from_status ?? '—'} → {h.to_status} ({h.reason})</li>)}</ul></>}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={busy || !status || reason.trim().length < 3} onClick={() => run(async () => { await post(`/producers/${p.id}/status`, { status, reason }); onDone(); })}>Changer le statut</button></div>
    </Modal>
  );
}
