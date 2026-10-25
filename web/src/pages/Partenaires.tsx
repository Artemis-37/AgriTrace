import { useState } from 'react';
import { del, get, post, put } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, ErrorBox, Field, Loading, Modal, PageHeader, Table, useAction, useAsync } from '../ui';

const KINDS: [string, string][] = [['partner', 'Partenaires'], ['supplier', 'Fournisseurs'], ['client', 'Clients'], ['lender', 'Prêteurs']];

/** Partenaires, fournisseurs, clients et prêteurs de la coopérative (menu Fichier de l'ancien logiciel). */
export default function Partenaires() {
  const { can } = useAuth();
  const [kind, setKind] = useState('partner');
  const { data, loading, error, reload } = useAsync(() => get<any[]>(`/partners?kind=${kind}`), [kind]);
  const [edit, setEdit] = useState<any | 'new' | null>(null);
  const act = useAction();
  return (
    <>
      <PageHeader title="Partenaires et fournisseurs" subtitle="Tiers de la coopérative : partenaires, fournisseurs, clients et prêteurs." />
      <Card>
        <div className="seg" role="radiogroup" aria-label="Type de tiers" style={{ marginBottom: '.8rem' }}>
          {KINDS.map(([k, l]) => <label key={k} className={kind === k ? 'on' : ''}><input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />{l}</label>)}
        </div>
        {can('partners:manage') && <div className="toolbar"><button className="btn" onClick={() => setEdit('new')}>Nouveau</button></div>}
        {error && <ErrorBox message={error} onRetry={reload} />}{act.error && <ErrorBox message={act.error} />}
        {loading ? <Loading /> : <div className="table-scroll"><Table rows={data ?? []} empty="Aucun élément." columns={[
          { header: 'Nom', render: (p) => <strong>{p.name}</strong> }, { header: 'Téléphone', render: (p) => p.phone ?? '' }, { header: 'Courriel', render: (p) => p.email ?? '' },
          { header: 'Adresse', render: (p) => p.address ?? '' }, { header: 'N° contribuable', render: (p) => p.tax_id ?? '' }, { header: 'Actif', render: (p) => <Badge tone={p.active ? 'ok' : 'neutral'}>{p.active ? 'Oui' : 'Non'}</Badge> },
          { header: '', render: (p) => can('partners:manage') ? (
            <span className="row-actions"><button className="btn btn-small btn-secondary" onClick={() => setEdit(p)}>Modifier</button>
              <button className="btn btn-small btn-ghost" disabled={act.busy} onClick={() => { if (confirm(`Supprimer « ${p.name} » ?`)) act.run(async () => { await del(`/partners/${p.id}`); reload(); }); }}>Supprimer</button></span>) : null },
        ]} /></div>}
        {edit && <Form kind={kind} p={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
      </Card>
    </>
  );
}

function Form({ kind, p, onClose, onDone }: { kind: string; p: any | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: p?.name ?? '', phone: p?.phone ?? '', email: p?.email ?? '', address: p?.address ?? '', tax: p?.tax_id ?? '', notes: p?.notes ?? '', active: p?.active ?? true });
  const act = useAction();
  const s = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={p ? 'Modifier' : 'Nouveau'} onClose={onClose}>
      <Field label="Nom"><input value={f.name} onChange={s('name')} maxLength={120} /></Field>
      <div className="grid-2"><Field label="Téléphone"><input value={f.phone} onChange={s('phone')} maxLength={30} /></Field><Field label="Courriel"><input value={f.email} onChange={s('email')} maxLength={120} /></Field></div>
      <Field label="Adresse"><input value={f.address} onChange={s('address')} maxLength={200} /></Field>
      <Field label="N° de contribuable"><input value={f.tax} onChange={s('tax')} maxLength={40} /></Field>
      <Field label="Remarques"><input value={f.notes} onChange={s('notes')} maxLength={500} /></Field>
      <label><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Actif</label>
      {act.error && <ErrorBox message={act.error} />}
      <div className="modal-actions"><button className="btn" disabled={act.busy || !f.name.trim()} onClick={() => act.run(async () => {
        const body = { kind, name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim(), address: f.address.trim(), tax_id: f.tax.trim(), notes: f.notes.trim(), active: f.active };
        if (p) await put(`/partners/${p.id}`, body); else await post('/partners', body);
        onDone();
      })}>Enregistrer</button><button className="btn btn-ghost" onClick={onClose}>Annuler</button></div>
    </Modal>
  );
}
