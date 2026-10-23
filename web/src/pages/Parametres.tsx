import { useState } from 'react';
import { del, get, post, put } from '../api';
import { useAuth } from '../auth';
import { date } from '../format';
import { Badge, Card, ErrorBox, Field, Loading, Modal, PageHeader, Table, Tabs, useAction, useAsync } from '../ui';

const PRICE = /^\d{1,12}(\.\d{1,2})?$/;
const FR = (v: any) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 }));

/** Paramètres : produits (prix d'achat et de vente au kilo) et campagnes, comme dans le menu Fichier de l'ancien logiciel. */
export default function Parametres() {
  const { can } = useAuth();
  const tabs: [string, string][] = [];
  if (can('products:read')) tabs.push(['products', 'Produits']);
  if (can('campaigns:read')) tabs.push(['campaigns', 'Campagnes']);
  const [tab, setTab] = useState(tabs[0]?.[0] ?? 'products');
  return (
    <>
      <PageHeader title="Produits et campagnes" subtitle="Produits achetés (prix d'achat et de vente au kilo) et campagnes de collecte." />
      <Tabs tabs={tabs as any} value={tab as any} onChange={setTab as any} />
      {tab === 'products' ? <Products /> : <Campaigns />}
    </>
  );
}

function Products() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/products'), []);
  const [edit, setEdit] = useState<any | 'new' | null>(null);
  const act = useAction();
  return (
    <Card>
      {can('products:manage') && <div className="toolbar"><button className="btn" onClick={() => setEdit('new')}>Nouveau</button></div>}
      {error && <ErrorBox message={error} onRetry={reload} />}{act.error && <ErrorBox message={act.error} />}
      {loading ? <Loading /> : <Table rows={data ?? []} empty="Aucun produit." columns={[
        { header: 'Désignation', render: (p) => <strong>{p.name}</strong> }, { header: 'Prix achat /kg', align: 'right', render: (p) => FR(p.buy_price_per_kg) },
        { header: 'Prix vente /kg', align: 'right', render: (p) => FR(p.sell_price_per_kg) }, { header: 'Actif', render: (p) => <Badge tone={p.active ? 'ok' : 'neutral'}>{p.active ? 'Oui' : 'Non'}</Badge> },
        { header: '', render: (p) => can('products:manage') ? (
          <span className="row-actions"><button className="btn btn-small btn-secondary" onClick={() => setEdit(p)}>Modifier</button>
            <button className="btn btn-small btn-ghost" disabled={act.busy} onClick={() => { if (confirm(`Supprimer le produit « ${p.name} » ?`)) act.run(async () => { await del(`/products/${p.id}`); reload(); }); }}>Supprimer</button></span>) : null },
      ]} />}
      {edit && <ProductForm p={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </Card>
  );
}

function ProductForm({ p, onClose, onDone }: { p: any | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: p?.name ?? '', buy: p?.buy_price_per_kg ? String(Number(p.buy_price_per_kg)) : '', sell: p?.sell_price_per_kg ? String(Number(p.sell_price_per_kg)) : '', active: p?.active ?? true });
  const act = useAction();
  const ok = f.name.trim() && (f.buy === '' || PRICE.test(f.buy)) && (f.sell === '' || PRICE.test(f.sell));
  return (
    <Modal title={p ? 'Modifier le produit' : 'Nouveau produit'} onClose={onClose}>
      <Field label="Désignation"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} /></Field>
      <div className="grid-2"><Field label="Prix d'achat au kilo"><input inputMode="decimal" value={f.buy} onChange={(e) => setF({ ...f, buy: e.target.value })} /></Field>
        <Field label="Prix de vente au kilo"><input inputMode="decimal" value={f.sell} onChange={(e) => setF({ ...f, sell: e.target.value })} /></Field></div>
      <label><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Actif</label>
      {act.error && <ErrorBox message={act.error} />}
      <div className="modal-actions"><button className="btn" disabled={act.busy || !ok} onClick={() => act.run(async () => {
        const body = { name: f.name.trim(), ...(f.buy && { buy_price_per_kg: f.buy }), ...(f.sell && { sell_price_per_kg: f.sell }), active: f.active };
        if (p) await put(`/products/${p.id}`, body); else await post('/products', body);
        onDone();
      })}>Enregistrer</button><button className="btn btn-ghost" onClick={onClose}>Annuler</button></div>
    </Modal>
  );
}

const CSTATUS: Record<string, string> = { planned: 'Prévue', open: 'Ouverte', closed: 'Clôturée' };
function Campaigns() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useAsync(async () => ({ list: await get<any[]>('/campaigns'), chains: await get<any[]>('/value-chains').catch(() => [] as any[]) }), []);
  const [adding, setAdding] = useState(false);
  return (
    <Card>
      {can('campaigns:manage') && <div className="toolbar"><button className="btn" onClick={() => setAdding(true)}>Nouvelle campagne</button></div>}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading || !data ? <Loading /> : <Table rows={data.list} empty="Aucune campagne." columns={[
        { header: 'Code', render: (c) => <code>{c.code}</code> }, { header: 'Campagne', render: (c) => <strong>{c.name}</strong> },
        { header: 'Filière', render: (c) => data.chains.find((v) => v.id === c.value_chain_id)?.name ?? '' },
        { header: 'Début', render: (c) => date(c.starts_on) }, { header: 'Fin', render: (c) => date(c.ends_on) }, { header: 'État', render: (c) => <Badge tone={c.status === 'open' ? 'ok' : 'neutral'}>{CSTATUS[c.status] ?? c.status}</Badge> },
      ]} />}
      {adding && data && <CampaignForm chains={data.chains} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
    </Card>
  );
}

function CampaignForm({ chains, onClose, onDone }: { chains: any[]; onClose: () => void; onDone: () => void }) {
  const y = new Date().getFullYear();
  const [f, setF] = useState({ chain: chains[0]?.id ?? '', code: `${y}-${y + 1}`, name: `Campagne ${y}-${y + 1}`, starts_on: `${y}-09-01`, ends_on: `${y + 1}-08-31` });
  const act = useAction();
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Nouvelle campagne" onClose={onClose}>
      <Field label="Filière"><select value={f.chain} onChange={set('chain')}>{chains.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <div className="grid-2"><Field label="Code" hint="Majuscules, chiffres, tirets"><input value={f.code} onChange={set('code')} /></Field><Field label="Nom"><input value={f.name} onChange={set('name')} /></Field>
        <Field label="Début"><input type="date" value={f.starts_on} onChange={set('starts_on')} /></Field><Field label="Fin"><input type="date" value={f.ends_on} onChange={set('ends_on')} /></Field></div>
      {act.error && <ErrorBox message={act.error} />}
      <div className="modal-actions"><button className="btn" disabled={act.busy || !f.chain} onClick={() => act.run(async () => { await post('/campaigns', { value_chain_id: f.chain, code: f.code.trim().toUpperCase(), name: f.name.trim(), starts_on: f.starts_on, ends_on: f.ends_on }); onDone(); })}>Enregistrer</button><button className="btn btn-ghost" onClick={onClose}>Annuler</button></div>
    </Modal>
  );
}
