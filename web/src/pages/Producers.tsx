import { FormEvent, useState } from 'react';
import { get, post } from '../api';
import { useAuth } from '../auth';
import { Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, StatusBadge, Table, useAction, useAsync } from '../ui';

export default function Producers() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/producers'), []);

  const rows = (data ?? []).filter((p) => `${p.internal_code} ${p.last_name} ${p.first_names} ${p.village ?? ''} ${p.phone ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHeader title="Producteurs" subtitle="Registre des producteurs de la coopérative"
        actions={can('producers:create') && <button className="btn" onClick={() => setCreating(true)}>Nouveau producteur</button>} />
      <Card>
        <div className="toolbar"><input type="search" aria-label="Rechercher" placeholder="Rechercher (nom, code, village, téléphone)" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 300 }} /></div>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {loading ? <Loading /> : (
          <Table rows={rows} empty="Aucun producteur trouvé." columns={[
            { header: 'Code', render: (p) => p.internal_code },
            { header: 'Nom', render: (p) => <strong>{p.last_name} {p.first_names}</strong> },
            { header: 'Village', render: (p) => p.village ?? '—' },
            { header: 'Section', render: (p) => p.section ?? '—' },
            { header: 'Téléphone', render: (p) => p.phone ?? '—' },
            { header: 'Statut', render: (p) => <StatusBadge map={{ active: ['Actif', 'ok'], inactive: ['Inactif', 'neutral'] }} value={p.status} /> },
          ]} />
        )}
      </Card>
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
