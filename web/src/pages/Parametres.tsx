import { useState } from 'react';
import { del, get, post, put } from '../api';
import { getChains } from '../chains';
import { useAuth } from '../auth';
import { date } from '../format';
import Societe from './Societe';
import Equipe from './Equipe';
import { Badge, Card, ErrorBox, Field, Loading, Modal, PageHeader, Table, useAction, useAsync } from '../ui';

const PRICE = /^\d{1,12}(\.\d{1,2})?$/;
const FR = (v: any) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 }));

/** Paramètres : tout ce qui se règle, regroupé par rubrique dans un menu à gauche (société, produits et prix, utilisateurs et accès). */
export default function Parametres({ start }: { start?: string } = {}) {
  const { can } = useAuth();
  type Item = [string, string];
  const groups = ([
    { title: 'Société', items: can('org:branding') ? [['societe', 'Informations et logo'] as Item] : [] },
    { title: 'Produits et prix', items: [...(can('products:read') ? [['products', 'Produits'] as Item] : []), ...(can('campaigns:read') ? [['campaigns', 'Traites (grande / petite)'] as Item] : [])] },
    { title: 'Utilisateurs et accès', items: [
      ...(can('users:create') ? [['u-new', 'Créer un utilisateur'] as Item] : []),
      ...(can('users:read') ? [['users', 'Liste des utilisateurs'] as Item] : []),
      ...(can('roles:manage') ? [['roles', 'Rôles et droits'] as Item] : []),
      ...(can('collectors:manage') ? [['delegues', 'Accès des délégués'] as Item] : []),
      ...(can('workstations:manage') ? [['postes', 'Postes de travail'] as Item] : []),
    ] },
  ] as { title: string; items: Item[] }[]).filter((g) => g.items.length);
  const first = start ?? groups[0]?.items[0]?.[0] ?? 'products';
  const [cur, setCur] = useState(first);
  const [n, setN] = useState(0);
  const [open, setOpen] = useState(groups.find((g) => g.items.some(([k]) => k === first))?.title ?? groups[0]?.title ?? '');
  if (!groups.length) return <Card><p className="muted">Votre rôle ne donne accès à aucun paramètre.</p></Card>;
  const pick = (k: string) => { if (k === 'u-new') { setN((x) => x + 1); setCur('users-new'); } else setCur(k); };
  const view = cur === 'societe' ? <Societe /> : cur === 'products' ? <Products /> : cur === 'campaigns' ? <Campaigns />
    : <Equipe embedded section={cur === 'users-new' ? 'users' : cur} openAdd={cur === 'users-new' ? n : 0} key={cur + n} />;
  return (
    <>
      <PageHeader title="Paramètres" subtitle="Société, produits et prix, utilisateurs et accès : choisissez une rubrique à gauche." />
      <div className="caisse-layout">
        <nav className="accordion" aria-label="Menu des paramètres">
          {groups.map((g) => (
            <div key={g.title} className={open === g.title ? 'open' : ''}>
              <button className="acc-head" aria-expanded={open === g.title} onClick={() => setOpen(open === g.title ? '' : g.title)}>{g.title}<span aria-hidden="true">{open === g.title ? '▴' : '▾'}</span></button>
              {open === g.title && <ul>{g.items.map(([k, l]) => <li key={k}><button className={cur === k || (k === 'users' && cur === 'users-new') ? 'on' : ''} onClick={() => pick(k)}>{l}</button></li>)}</ul>}
            </div>
          ))}
        </nav>
        <div className="caisse-main">{view}</div>
      </div>
    </>
  );
}

function Products() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/products'), []);
  const [edit, setEdit] = useState<any | 'new' | null>(null);
  const [hist, setHist] = useState<any | null>(null);
  const act = useAction();
  return (
    <Card>
      {can('products:manage') && <div className="toolbar"><button className="btn" onClick={() => setEdit('new')}>Nouveau</button></div>}
      <p className="muted">Un produit n'a pas de prix propre : son prix d'achat et de vente au kilo se fixe pour chaque traite, dans la rubrique « Traites », bouton « Prix ». La caisse, les pesées et les ventes reprennent le prix de la traite en cours.</p>
      {error && <ErrorBox message={error} onRetry={reload} />}{act.error && <ErrorBox message={act.error} />}
      {loading ? <Loading /> : <Table rows={data ?? []} empty="Aucun produit." columns={[
        { header: 'Désignation', render: (p) => <strong>{p.name}</strong> }, { header: 'Prix par traite (achat / vente au kg)', render: (p) => <TraitePriceCell p={p} /> },
        { header: 'Actif', render: (p) => <Badge tone={p.active ? 'ok' : 'neutral'}>{p.active ? 'Oui' : 'Non'}</Badge> },
        { header: '', render: (p) => can('products:manage') ? (
          <span className="row-actions"><button className="btn btn-small btn-secondary" onClick={() => setEdit(p)}>Modifier</button>
            <button className="btn btn-small btn-ghost" onClick={() => setHist(p)}>Historique des prix</button>
            <button className="btn btn-small btn-ghost" disabled={act.busy} onClick={() => { if (confirm(`Supprimer le produit « ${p.name} » ?`)) act.run(async () => { await del(`/products/${p.id}`); reload(); }); }}>Supprimer</button></span>) : null },
      ]} />}
      {hist && <PriceHistory p={hist} onClose={() => setHist(null)} />}
      {edit && <ProductForm p={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </Card>
  );
}

function PriceHistory({ p, onClose }: { p: any; onClose: () => void }) {
  const { data, loading, error } = useAsync(() => get<any[]>(`/products/${p.id}/prices`), [p.id]);
  return (
    <Modal title={`Historique des prix — ${p.name}`} onClose={onClose}>
      {loading && <Loading />}{error && <ErrorBox message={error} />}
      {data && <Table rows={data} empty="Aucun prix fixé." columns={[
        { header: 'Date', render: (r: any) => date(r.created_at) }, { header: 'Traite (campagne)', render: (r: any) => r.campaign_name ?? 'Générale' },
        { header: 'Achat /kg', align: 'right', render: (r: any) => FR(r.buy_price_per_kg) }, { header: 'Vente /kg', align: 'right', render: (r: any) => FR(r.sell_price_per_kg) }, { header: 'Fixé par', render: (r: any) => r.set_by ?? '—' }]} />}
    </Modal>
  );
}

/** Derniers prix fixés pour chaque traite d'un produit (un produit n'a pas de prix en dehors des traites). */
function TraitePriceCell({ p }: { p: any }) {
  const { data, loading } = useAsync(() => get<any[]>(`/products/${p.id}/prices`).catch(() => [] as any[]), [p.id]);
  if (loading) return <span className="muted">…</span>;
  const last = new Map<string, any>();
  for (const r of data ?? []) if (r.campaign_id && !last.has(r.campaign_id)) last.set(r.campaign_id, r);
  if (!last.size) return <span className="muted">Aucun prix : fixez-le dans « Traites »</span>;
  return <div>{[...last.values()].map((r) => <div key={r.campaign_id}><strong>{r.campaign_name}</strong> : {FR(r.buy_price_per_kg) || '—'} / {FR(r.sell_price_per_kg) || '—'}</div>)}</div>;
}

function ProductForm({ p, onClose, onDone }: { p: any | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: p?.name ?? '', active: p?.active ?? true, chain: p?.value_chain_id ?? '' });
  const chains = useAsync(() => getChains().catch(() => [] as any[]), []);
  const act = useAction();
  const ok = !!f.name.trim();
  return (
    <Modal title={p ? 'Modifier le produit' : 'Nouveau produit'} onClose={onClose}>
      <Field label="Désignation"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} /></Field>
      <p className="hint">Le prix d'achat et de vente de ce produit se fixe pour chaque traite (rubrique « Traites »).</p>
      <Field label="Filière (déclarations d'achat)" hint="Si une filière est choisie, les déclarations d'achat de cette filière utilisent le prix d'achat de la traite en cours pour ce produit."><select value={f.chain} onChange={(e) => setF({ ...f, chain: e.target.value })}><option value="">— Aucune —</option>{(chains.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
      {(chains.data ?? []).length === 0 && <p className="hint">Aucune filière disponible : demandez à l'administrateur de la coopérative de les activer.</p>}
      <label><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Actif</label>
      {act.error && <ErrorBox message={act.error} />}
      <div className="modal-actions"><button className="btn" disabled={act.busy || !ok} onClick={() => act.run(async () => {
        const body = { name: f.name.trim(), active: f.active, value_chain_id: f.chain || null };
        if (p) await put(`/products/${p.id}`, body); else await post('/products', body);
        onDone();
      })}>Enregistrer</button><button className="btn btn-ghost" onClick={onClose}>Annuler</button></div>
    </Modal>
  );
}

const CSTATUS: Record<string, string> = { planned: 'Prévue', open: 'Ouverte', closed: 'Clôturée' };
const TRAITE: Record<string, string> = { grande: 'Grande traite', petite: 'Petite traite' };
function Campaigns() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useAsync(async () => ({ list: await get<any[]>('/campaigns'), chains: await getChains().catch(() => [] as any[]) }), []);
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState<any | null>(null);
  const [prices, setPrices] = useState<any | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const current = (c: any) => c.status === 'open' && String(c.starts_on).slice(0, 10) <= today && today <= String(c.ends_on).slice(0, 10);
  return (
    <Card>
      {can('campaigns:manage') && <div className="toolbar"><button className="btn" onClick={() => setAdding(true)}>Nouvelle traite</button></div>}
      <p className="muted">Grande traite : en général d'octobre à mars. Petite traite : d'avril à septembre. Les dates sont libres ; à une date donnée, une seule traite par filière fixe le prix.</p>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading || !data ? <Loading /> : <Table rows={data.list} empty="Aucune traite." columns={[
        { header: 'Traite', render: (c) => <strong>{TRAITE[c.traite] ?? 'Campagne'}</strong> }, { header: 'Nom', render: (c) => <>{c.name} <code>{c.code}</code></> },
        { header: 'Filière', render: (c) => data.chains.find((v) => v.id === c.value_chain_id)?.name ?? '' },
        { header: 'Produits et prix (achat / vente au kg)', render: (c) => (c.products ?? []).length ? <div>{c.products.map((p: any) => <div key={p.id}><strong>{p.name}</strong> : {FR(p.buy_price_per_kg) || '—'} / {FR(p.sell_price_per_kg) || '—'}</div>)}</div> : <span className="muted">Aucun produit : cliquez sur « Prix »</span> },
        { header: 'Début', render: (c) => date(c.starts_on) }, { header: 'Fin', render: (c) => date(c.ends_on) },
        { header: 'État', render: (c) => <Badge tone={current(c) ? 'ok' : 'neutral'}>{current(c) ? 'En cours' : CSTATUS[c.status] ?? c.status}</Badge> },
        { header: '', render: (c) => <span className="row-actions">
          {can('products:read') && <button className="btn btn-small btn-secondary" onClick={() => setPrices(c)}>Prix</button>}
          {can('campaigns:manage') && <button className="btn btn-small btn-ghost" onClick={() => setEdit(c)}>Modifier</button>}</span> },
      ]} />}
      {adding && data && <CampaignForm chains={data.chains} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
      {edit && <CampaignEdit c={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
      {prices && <TraitePrices c={prices} onClose={() => { setPrices(null); reload(); }} />}
    </Card>
  );
}

/** Dates et nom proposés selon le type de traite (modifiables). */
function traiteDefaults(kind: 'grande' | 'petite', y: number) {
  return kind === 'grande'
    ? { code: `GT${String(y).slice(2)}${String(y + 1).slice(2)}`, name: `Grande traite ${y}-${y + 1}`, starts_on: `${y}-10-01`, ends_on: `${y + 1}-03-31` }
    : { code: `PT${y}`, name: `Petite traite ${y}`, starts_on: `${y}-04-01`, ends_on: `${y}-09-30` };
}

/** Saisie des prix d'achat et de vente de chaque produit pour une traite donnée. */
function PriceFields({ prods, px, setPx, existing }: { prods: any[]; px: Record<string, { buy: string; sell: string }>; setPx: (v: Record<string, { buy: string; sell: string }>) => void; existing?: Record<string, { buy: string; sell: string }> }) {
  const val = (p: any) => px[p.id] ?? existing?.[p.id] ?? { buy: '', sell: '' };
  return <>{prods.filter((p) => p.active).map((p) => (
    <div key={p.id} className="price-row"><strong>{p.name}</strong>
      <div className="grid-2"><Field label="Achat (FCFA/kg)"><input inputMode="decimal" value={val(p).buy} onChange={(e) => setPx({ ...px, [p.id]: { ...val(p), buy: e.target.value } })} /></Field>
        <Field label="Vente (FCFA/kg)"><input inputMode="decimal" value={val(p).sell} onChange={(e) => setPx({ ...px, [p.id]: { ...val(p), sell: e.target.value } })} /></Field></div></div>))}</>;
}

function CampaignForm({ chains, onClose, onDone }: { chains: any[]; onClose: () => void; onDone: () => void }) {
  const y = new Date().getFullYear();
  const [kind, setKind] = useState<'grande' | 'petite'>('grande');
  const [f, setF] = useState({ chain: (chains.find((c) => String(c.code).toUpperCase() === 'CACAO') ?? chains[0])?.id ?? '', ...traiteDefaults('grande', new Date().getMonth() < 3 ? y - 1 : y) });
  const act = useAction();
  const prods = useAsync(() => get<any[]>('/products'), []);
  const [px, setPx] = useState<Record<string, { buy: string; sell: string }>>({});
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const pick = (k: 'grande' | 'petite') => { setKind(k); setF({ ...f, ...traiteDefaults(k, k === 'petite' && new Date().getMonth() >= 9 ? y + 1 : new Date().getMonth() < 3 && k === 'grande' ? y - 1 : y) }); };
  const okPx = (p: any) => (['buy', 'sell'] as const).every((k) => (px[p.id]?.[k] ?? '') === '' || PRICE.test(String(px[p.id][k])));
  return (
    <Modal title="Nouvelle traite" onClose={onClose}>
      <div className="grid-2"><Field label="Type de traite"><select value={kind} onChange={(e) => pick(e.target.value as any)}><option value="grande">Grande traite</option><option value="petite">Petite traite</option></select></Field>
        <Field label="Filière"><select value={f.chain} onChange={set('chain')}>{chains.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field></div>
      <div className="grid-2"><Field label="Début de la traite"><input type="date" value={f.starts_on} onChange={set('starts_on')} /></Field><Field label="Fin de la traite"><input type="date" value={f.ends_on} onChange={set('ends_on')} /></Field>
        <Field label="Nom"><input value={f.name} onChange={set('name')} /></Field><Field label="Code" hint="Majuscules, chiffres, tirets"><input value={f.code} onChange={set('code')} /></Field></div>
      <fieldset className="bloc"><legend>Prix de la traite (au kilo)</legend>
        <p className="muted">Fixés par l'administrateur ; ils s'appliquent à toutes les pesées de cette traite (caisse, stocks, ventes) et restent modifiables ensuite.</p>
        <PriceFields prods={prods.data ?? []} px={px} setPx={setPx} />
      </fieldset>
      {act.error && <ErrorBox message={act.error} />}
      <div className="modal-actions"><button className="btn" disabled={act.busy || !f.chain || !f.name.trim() || !f.starts_on || !f.ends_on || f.ends_on < f.starts_on || !(prods.data ?? []).every(okPx)} onClick={() => act.run(async () => {
        const camp: any = await post('/campaigns', { value_chain_id: f.chain, code: f.code.trim().toUpperCase(), name: f.name.trim(), starts_on: f.starts_on, ends_on: f.ends_on, traite: kind });
        for (const p of (prods.data ?? []).filter((x) => x.active)) { const v = px[p.id]; if (v && (v.buy !== '' || v.sell !== '')) await post(`/products/${p.id}/prices`, { campaign_id: camp.id, ...(v.buy !== '' && { buy_price_per_kg: String(v.buy) }), ...(v.sell !== '' && { sell_price_per_kg: String(v.sell) }) }); }
        onDone(); })}>Enregistrer</button><button className="btn btn-ghost" onClick={onClose}>Annuler</button></div>
    </Modal>
  );
}

function CampaignEdit({ c, onClose, onDone }: { c: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: c.name, starts_on: String(c.starts_on).slice(0, 10), ends_on: String(c.ends_on).slice(0, 10), status: c.status });
  const act = useAction();
  return (
    <Modal title={`${TRAITE[c.traite] ?? 'Traite'} — ${c.code}`} onClose={onClose}>
      <Field label="Nom"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className="grid-2"><Field label="Début"><input type="date" value={f.starts_on} onChange={(e) => setF({ ...f, starts_on: e.target.value })} /></Field>
        <Field label="Fin"><input type="date" value={f.ends_on} onChange={(e) => setF({ ...f, ends_on: e.target.value })} /></Field></div>
      <Field label="État"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{Object.entries(CSTATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      {act.error && <ErrorBox message={act.error} />}
      <div className="modal-actions"><button className="btn" disabled={act.busy || !f.name.trim() || f.ends_on < f.starts_on} onClick={() => act.run(async () => { await put(`/campaigns/${c.id}`, f); onDone(); })}>Enregistrer</button><button className="btn btn-ghost" onClick={onClose}>Annuler</button></div>
    </Modal>
  );
}

/** Produits associés à une traite : ajout et retrait (un produit se retire tant qu'aucune pesée ne s'y rattache). */
function TraiteProducts({ c, prods, onChanged }: { c: any; prods: any[]; onChanged: () => void }) {
  const act = useAction();
  const [linked, setLinked] = useState<string[]>((c.products ?? []).map((p: any) => p.id));
  const [pick, setPick] = useState('');
  const free = prods.filter((p) => p.active && !linked.includes(p.id));
  return (
    <fieldset className="bloc"><legend>Produits de cette traite</legend>
      <div className="chips">{prods.filter((p) => linked.includes(p.id)).map((p) => <span key={p.id} className="chip">{p.name} <button className="link-btn" disabled={act.busy} title="Retirer ce produit de la traite" onClick={() => act.run(async () => { await del(`/campaigns/${c.id}/products/${p.id}`); setLinked(linked.filter((x) => x !== p.id)); onChanged(); })}>×</button></span>)}
        {!linked.length && <span className="muted">Aucun produit : ajoutez-en un, puis fixez son prix.</span>}</div>
      {free.length > 0 && <div className="toolbar"><select value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Ajouter un produit…</option>{free.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <button className="btn btn-small" disabled={!pick || act.busy} onClick={() => act.run(async () => { await post(`/campaigns/${c.id}/products/${pick}`); setLinked([...linked, pick]); setPick(''); onChanged(); })}>Ajouter</button></div>}
      {act.error && <ErrorBox message={act.error} />}
    </fieldset>
  );
}

/** Prix des produits d'une traite déjà créée : lecture du dernier prix fixé pour cette traite, puis révision. */
function TraitePrices({ c, onClose }: { c: any; onClose: () => void }) {
  const { can } = useAuth();
  const act = useAction();
  const [px, setPx] = useState<Record<string, { buy: string; sell: string }>>({});
  const data = useAsync(async () => {
    const prods = await get<any[]>('/products');
    const existing: Record<string, { buy: string; sell: string }> = {};
    for (const p of prods) {
      const h = await get<any[]>(`/products/${p.id}/prices`).catch(() => [] as any[]);
      const last = h.find((x) => x.campaign_id === c.id);
      if (last) existing[p.id] = { buy: last.buy_price_per_kg != null ? String(Number(last.buy_price_per_kg)) : '', sell: last.sell_price_per_kg != null ? String(Number(last.sell_price_per_kg)) : '' };
    }
    return { prods, existing };
  }, [c.id]);
  const may = can('products:manage');
  const ok = Object.values(px).every((v) => (v.buy === '' || PRICE.test(v.buy)) && (v.sell === '' || PRICE.test(v.sell)));
  return (
    <Modal title={`Prix — ${c.name}`} onClose={onClose}>
      <p className="muted">Du {date(c.starts_on)} au {date(c.ends_on)}. Les produits de cette traite et leurs prix s'appliquent aux pesées, à la caisse et aux achats déclarés ; un changement de prix met à jour ce qui n'est pas encore pesé ou réglé.</p>
      {may && data.data && <TraiteProducts c={c} prods={data.data.prods} onChanged={data.reload} />}
      {data.loading && <Loading />}{data.error && <ErrorBox message={data.error} />}
      {data.data && (may ? <PriceFields prods={data.data.prods} px={px} setPx={setPx} existing={data.data.existing} />
        : data.data.prods.map((p: any) => <p key={p.id}><strong>{p.name}</strong> : {data.data!.existing[p.id] ? `${data.data!.existing[p.id].buy || '—'} / ${data.data!.existing[p.id].sell || '—'} FCFA/kg` : 'prix par défaut'}</p>))}
      {act.error && <ErrorBox message={act.error} />}
      <div className="modal-actions">{may && <button className="btn" disabled={act.busy || !ok || Object.keys(px).length === 0} onClick={() => act.run(async () => {
        for (const [id, v] of Object.entries(px)) if (v.buy !== '' || v.sell !== '') await post(`/products/${id}/prices`, { campaign_id: c.id, ...(v.buy !== '' && { buy_price_per_kg: v.buy }), ...(v.sell !== '' && { sell_price_per_kg: v.sell }) });
        onClose(); })}>Enregistrer les prix</button>}<button className="btn btn-ghost" onClick={onClose}>Fermer</button></div>
    </Modal>
  );
}
