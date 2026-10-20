import { useEffect, useState } from 'react';
import { get, idem, post } from '../api';
import { useAuth } from '../auth';
import { enqueue, onFlushed, useOffline } from '../offline';
import { Badge, Card, ErrorBox, Field, Loading, Modal, PageHeader, Table, Tabs, useAction, useAsync } from '../ui';

const STATUS: Record<string, [string, import('../format').Tone]> = { in_transit: ['En route', 'warn'], received: ['Reçu — en caisse', 'neutral'], settled: ['Réglé', 'ok'] };
const num = (v: any) => Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 3 });

/** Convois des collecteurs (délégués) vers le magasin central : déclaration, réception et pesée, traitement en caisse. */
export default function Convois() {
  const { can } = useAuth();
  const tabs: [string, string][] = [];
  if (can('convoys:read')) tabs.push(['list', 'Convois']);
  if (can('convoys:receive')) tabs.push(['receive', 'Réception au magasin']);
  if (can('convoys:settle')) tabs.push(['cash', 'Caisse']);
  const [tab, setTab] = useState(tabs[0]?.[0] ?? 'list');
  return (
    <>
      <PageHeader title="Convois des collecteurs" subtitle="Achats chez les producteurs convoyés vers le magasin central, pesés à la réception puis réglés en caisse." />
      <Tabs tabs={tabs as any} value={tab as any} onChange={setTab as any} />
      {tab === 'list' && <List />}
      {tab === 'receive' && <Receive />}
      {tab === 'cash' && <Cash />}
    </>
  );
}

function List() {
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/convoys'), []);
  useEffect(() => onFlushed(reload), [reload]);
  return (
    <Card>
      <div className="toolbar">{can('convoys:create') && <button className="btn" onClick={() => setCreating(true)}>Déclarer un convoi</button>}</div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : (
        <Table rows={data ?? []} empty="Aucun convoi." columns={[
          { header: 'N° de convoi', render: (v) => v.convoy_no }, { header: 'Collecteur', render: (v) => v.collector_name },
          { header: 'Chauffeur', render: (v) => v.driver_name }, { header: 'Camion', render: (v) => v.truck_no },
          { header: 'Poids reçu (kg)', align: 'right', render: (v) => (v.total_kg ? num(v.total_kg) : '—') },
          { header: 'Sacs', align: 'right', render: (v) => v.bags ?? '—' },
          { header: 'Montant', align: 'right', render: (v) => (v.amount ? num(v.amount) : '—') },
          { header: 'État', render: (v) => <Badge tone={STATUS[v.status]?.[1] ?? 'neutral'}>{STATUS[v.status]?.[0] ?? v.status}</Badge> },
        ]} />
      )}
      {creating && <CreateConvoy onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />}
    </Card>
  );
}

function CreateConvoy({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { org } = useAuth();
  const off = useOffline();
  const act = useAction();
  const [f, setF] = useState({ convoy_no: '', driver_name: '', truck_no: '', declared_bags: '', declared_kg: '' });
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const valid = f.convoy_no.trim().length >= 2 && f.driver_name.trim().length >= 2 && f.truck_no.trim().length >= 2 && (!f.declared_kg || /^\d+(\.\d{1,3})?$/.test(f.declared_kg));
  return (
    <Modal title="Déclarer un convoi" onClose={onClose}>
      {off.offline && <p className="notice" role="status">Hors connexion : le convoi sera enregistré sur ce poste puis envoyé dès que le serveur sera joignable.</p>}
      <Field label="Numéro de connaissement du convoi" hint="Saisi par le collecteur ; il accompagne le convoi jusqu'au magasin."><input value={f.convoy_no} onChange={set('convoy_no')} maxLength={60} /></Field>
      <Field label="Nom du chauffeur"><input value={f.driver_name} onChange={set('driver_name')} maxLength={120} /></Field>
      <Field label="N° du camion"><input value={f.truck_no} onChange={set('truck_no')} maxLength={40} /></Field>
      <Field label="Nombre de sacs annoncé (facultatif)"><input inputMode="numeric" value={f.declared_bags} onChange={set('declared_bags')} /></Field>
      <Field label="Poids annoncé en kg (facultatif)"><input inputMode="decimal" value={f.declared_kg} onChange={set('declared_kg')} /></Field>
      {act.error && <ErrorBox message={act.error} />}
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={act.busy || !valid || !org} onClick={() => act.run(async () => {
          await enqueue(org!.id, 'convoy.create', {
            idempotency_key: idem(), convoy_no: f.convoy_no.trim(), driver_name: f.driver_name.trim(), truck_no: f.truck_no.trim(),
            ...(f.declared_bags && { declared_bags: Number(f.declared_bags) }), ...(f.declared_kg && { declared_kg: f.declared_kg }),
          }, `Convoi ${f.convoy_no.trim()}`);
          onDone();
        })}>{off.offline ? 'Enregistrer sur ce poste' : 'Enregistrer'}</button>
      </div>
    </Modal>
  );
}

function Receive() {
  const { org } = useAuth();
  const act = useAction();
  const { data, loading, error, reload } = useAsync(async () => ({
    expected: await get<any[]>('/convoys/expected'), whs: await get<any[]>('/warehouses').catch(() => [] as any[]),
  }), []);
  useEffect(() => onFlushed(reload), [reload]);
  const [collector, setCollector] = useState('');
  const [convoyNo, setConvoyNo] = useState('');
  const [wh, setWh] = useState('');
  const [kg, setKg] = useState('');
  const [bags, setBags] = useState('');
  const [done, setDone] = useState('');
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? 'Chargement impossible'} onRetry={reload} />;
  const collectors = [...new Map(data.expected.map((v) => [v.collector_id, v.collector_name])).entries()];
  const mine = data.expected.filter((v) => v.collector_id === collector);
  const expected = mine.find((v) => v.convoy_no === convoyNo.trim());
  const valid = collector && convoyNo.trim().length >= 2 && wh && /^\d+(\.\d{1,3})?$/.test(kg) && Number(kg) > 0 && /^[1-9]\d*$/.test(bags);
  return (
    <Card title="Réceptionner un convoi">
      <Field label="Collecteur"><select value={collector} onChange={(e) => { setCollector(e.target.value); setConvoyNo(''); }}><option value="">—</option>{collectors.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></Field>
      <Field label="Numéro de connaissement du convoi" hint={mine.length ? `En route : ${mine.map((v) => v.convoy_no).join(', ')}` : undefined}>
        <input list="convois-attendus" value={convoyNo} onChange={(e) => setConvoyNo(e.target.value)} /></Field>
      <datalist id="convois-attendus">{mine.map((v) => <option key={v.id} value={v.convoy_no} />)}</datalist>
      {expected && <p className="muted">Chauffeur : {expected.driver_name} · Camion : {expected.truck_no}{expected.declared_kg ? ` · Annoncé : ${num(expected.declared_kg)} kg` : ''}{expected.declared_bags != null ? ` / ${expected.declared_bags} sacs` : ''}</p>}
      <Field label="Magasin"><select value={wh} onChange={(e) => setWh(e.target.value)}><option value="">—</option>{data.whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
      <Field label="Poids total pesé (kg)"><input inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} /></Field>
      <Field label="Nombre de sacs"><input inputMode="numeric" value={bags} onChange={(e) => setBags(e.target.value)} /></Field>
      {act.error && <ErrorBox message={act.error} />}
      {done && <p className="notice" role="status">{done}</p>}
      <div className="modal-actions"><button className="btn" disabled={act.busy || !valid || !org} onClick={() => act.run(async () => {
        await enqueue(org!.id, 'convoy.receive', { idempotency_key: idem(), collector_id: collector, convoy_no: convoyNo.trim(), warehouse_id: wh, total_kg: kg, bags: Number(bags) }, `Réception du convoi ${convoyNo.trim()}`);
        setDone(`Convoi ${convoyNo.trim()} enregistré : il sera transmis à la caisse dès l'envoi au serveur.`); setConvoyNo(''); setKg(''); setBags(''); reload();
      })}>Valider la réception et transmettre à la caisse</button></div>
    </Card>
  );
}

function Cash() {
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/convoys/cashier-queue'), []);
  useEffect(() => onFlushed(reload), [reload]);
  const [sel, setSel] = useState<any>(null);
  return (
    <Card title="Réceptions à traiter">
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : (
        <Table rows={data ?? []} empty="Aucune réception en attente." columns={[
          { header: 'N° de convoi', render: (r) => r.convoy_no }, { header: 'Collecteur', render: (r) => r.collector_name },
          { header: 'Poids (kg)', align: 'right', render: (r) => num(r.total_kg) }, { header: 'Sacs', align: 'right', render: (r) => r.bags },
          { header: 'Écart vs annoncé (kg)', align: 'right', render: (r) => (r.variance_kg == null ? '—' : num(r.variance_kg)) },
          { header: '', render: (r) => <button className="btn" onClick={() => setSel(r)}>Traiter</button> },
        ]} />
      )}
      {sel && <Settle r={sel} onClose={() => setSel(null)} onDone={() => { setSel(null); reload(); }} />}
    </Card>
  );
}

function Settle({ r, onClose, onDone }: { r: any; onClose: () => void; onDone: () => void }) {
  const act = useAction();
  const [price, setPrice] = useState('');
  const ok = /^\d+(\.\d{1,4})?$/.test(price) && Number(price) > 0;
  const amount = ok ? Math.round(Number(r.total_kg) * Number(price) * 100) / 100 : null;
  const [key] = useState(idem());
  return (
    <Modal title={`Traiter le convoi ${r.convoy_no}`} onClose={onClose}>
      <p>{r.collector_name} · {num(r.total_kg)} kg · {r.bags} sacs</p>
      <Field label="Prix au kg (FCFA)"><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
      {amount != null && <p className="notice">Montant à créditer au compte du collecteur : <strong>{amount.toLocaleString('fr-FR')} FCFA</strong></p>}
      {act.error && <ErrorBox message={act.error} />}
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={act.busy || !ok} onClick={() => act.run(async () => { await post(`/convoy-receptions/${r.id}/settle`, { idempotency_key: key, unit_price: price }); onDone(); })}>Créditer le compte du collecteur</button>
      </div>
    </Modal>
  );
}
