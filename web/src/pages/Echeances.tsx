import { useState } from 'react';
import { del, get, idem, post } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, ErrorBox, Field, Loading, Modal, Table, useAction, useAsync } from '../ui';

const FR = (v: any) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 }));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const AMT = /^\d{1,12}(\.\d{1,2})?$/;
const FRD = (d: string) => new Date(d).toLocaleDateString('fr-FR', { timeZone: 'UTC' });
const hour = (t: string) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
/** Campagne comptable par défaut : du 1er septembre au 31 août. */
export const campaignRange = (): [string, string] => { const n = new Date(); const y = n.getMonth() >= 8 ? n.getFullYear() : n.getFullYear() - 1; return [`${y}-09-01`, `${y + 1}-08-31`]; };
const preset = (p: string): [string, string] | null => {
  const n = new Date(), t = iso(n);
  if (p === 'today') return [t, t];
  if (p === 'week') { const d = new Date(n); d.setDate(n.getDate() - ((n.getDay() + 6) % 7)); return [iso(d), t]; }
  if (p === 'month') return [`${t.slice(0, 8)}01`, t];
  if (p === 'year') return [`${n.getFullYear()}-01-01`, `${n.getFullYear()}-12-31`];
  if (p === 'campaign') return campaignRange();
  return null;
};
/** Période : date de début, date de fin, « Afficher » et « Période prédéfinie », comme dans l'ancien logiciel. */
export function PeriodBar({ from, to, onShow }: { from: string; to: string; onShow: (from: string, to: string) => void }) {
  const [f, setF] = useState(from), [t, setT] = useState(to);
  return (
    <div className="period-bar">
      <label>Date de début <input type="date" value={f} onChange={(e) => setF(e.target.value)} /></label>
      <label>Date de fin <input type="date" value={t} onChange={(e) => setT(e.target.value)} /></label>
      <button className="btn" onClick={() => onShow(f, t)}>Afficher</button>
      <select aria-label="Période prédéfinie" value="" onChange={(e) => { const r = preset(e.target.value); if (r) { setF(r[0]); setT(r[1]); onShow(r[0], r[1]); } }}>
        <option value="">Période prédéfinie</option><option value="today">Aujourd'hui</option><option value="week">Cette semaine</option><option value="month">Ce mois</option><option value="year">Cette année</option><option value="campaign">Cette campagne (1er sept. – 31 août)</option>
      </select>
    </div>
  );
}
/** Pied de tableau « Somme » et barre de totaux à la manière de l'ancien logiciel. */
export const TotalBar = ({ items }: { items: [string, any][] }) => <div className="legacy-total">{items.map(([l, v]) => <span key={l}><em>{l}</em><b>{FR(v)}</b></span>)}</div>;

export type DueKind = 'supplier_invoice' | 'borrowing' | 'service' | 'other_sale' | 'tax';
const CFG: Record<DueKind, { title: string; heading: string; refCol?: string; party?: string; paidCol?: string; restCol?: string; totalCol?: string; add: string; pay: string; partner?: string; partnerKind?: string; ref: string; unit?: boolean }> = {
  supplier_invoice: { title: 'Factures des fournisseurs', heading: 'Les factures des fournisseurs', party: 'Fournisseur', add: 'Nouvelle facture', pay: 'Régler', partner: 'Fournisseur', partnerKind: 'supplier', ref: 'N° de facture', unit: true },
  borrowing: { title: 'Emprunts', heading: 'Les emprunts', paidCol: 'Remboursé', restCol: 'Reste à rembourser', party: 'Provenance', add: 'Nouvel emprunt', pay: 'Rembourser', partner: 'Prêteur (banque, institution)', partnerKind: 'lender', ref: 'N° de contrat' },
  service: { title: 'Prestations', heading: 'Les prestations', paidCol: 'Réglé', restCol: 'Reste', party: 'Prestataire', add: 'Nouvelle prestation', pay: 'Encaisser', partner: 'Client', partnerKind: 'client', ref: 'N° de facture', unit: true },
  other_sale: { title: 'Ventes d\'autres produits', heading: 'Les ventes d\'autres produits', party: 'Client', add: 'Nouvelle vente', pay: 'Encaisser', partner: 'Client', partnerKind: 'client', ref: 'N° de facture', unit: true },
  tax: { title: 'Impôts et taxes', heading: 'Les impôts et taxes', party: 'Nature', add: 'Nouvel impôt', pay: 'Régler', ref: 'N° de déclaration' },
};

/** État d'une rubrique d'échéances (fournisseurs, emprunts, prestations, ventes d'autres produits, impôts) : liste, total, règlement ou encaissement. */
export function Dues({ kind, startAdding = false }: { kind: DueKind; startAdding?: boolean }) {
  const { can } = useAuth();
  const c = CFG[kind];
  const [[from, to], setRange] = useState<[string, string]>(campaignRange());
  const [state, setState] = useState('all');
  const { data, loading, error, reload } = useAsync(() => get<any>(`/dues?kind=${kind}&state=${state}&from=${from}&to=${to}`), [kind, from, to, state]);
  const [adding, setAdding] = useState(startAdding);
  const [paying, setPaying] = useState<any | null>(null);
  const act = useAction();
  const receivable = kind === 'service' || kind === 'other_sale';
  const paidL = c.paidCol ?? (receivable ? 'Encaissé' : 'Réglé');
  const restL = c.restCol ?? 'Reste';
  return (
    <Card>
      <div className="journal-head"><h2 className="win-title">{c.heading} du {FRD(from)} au {FRD(to)}</h2>
        <PeriodBar key={`${from}${to}`} from={from} to={to} onShow={(f, t) => setRange([f, t])} /></div>
      <div className="toolbar">
        {can('dues:manage') && <button className="btn" onClick={() => setAdding(true)}>{c.add}</button>}
        <button className="btn btn-secondary" onClick={() => window.print()}>Imprimer</button>
        <span className="seg" role="radiogroup" aria-label="État">{[['all', 'Toutes'], ['open', receivable ? 'À encaisser' : 'À régler'], ['settled', 'Soldées']].map(([k, l]) => <button key={k} className={state === k ? 'on' : ''} onClick={() => setState(k)}>{l}</button>)}</span>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}{act.error && <ErrorBox message={act.error} />}
      {loading || !data ? <Loading /> : (
        <>
          <div className="table-scroll legacy-grid"><table>
            <thead><tr><th>N°</th><th>Date</th><th>Heure</th>{kind !== 'borrowing' && <th>{c.ref}</th>}<th>Libellé</th>{kind === 'borrowing' && <th>Taux / durée</th>}<th>Échéance</th><th className="r">Montant</th><th className="r">{paidL}</th><th className="r">{restL}</th><th>{c.party}</th><th /></tr></thead>
            <tbody>
              {data.rows.length === 0 && <tr><td colSpan={12} className="muted">Aucune opération sur la période.</td></tr>}
              {data.rows.map((r: any, i: number) => (
                <tr key={r.id}><td>{i + 1}</td><td>{FRD(r.issued_on)}</td><td>{hour(r.created_at)}</td>{kind !== 'borrowing' && <td>{r.ref_no ?? ''}</td>}<td>{r.label}</td>
                  {kind === 'borrowing' && <td>{FR(r.rate_pct)} % · {r.term_months} mois</td>}<td>{FRD(r.due_date)}</td>
                  <td className="r">{FR(r.amount)}</td><td className="r">{FR(r.paid)}</td><td className="r"><strong>{FR(r.remaining)}</strong></td>
                  <td>{r.partner_name ?? (r.tax_type ? `${r.tax_type}${r.period ? ` ${r.period}` : ''}` : '')}</td>
                  <td><span className="row-actions">
                    {Number(r.remaining) > 0 && can('dues:settle') && <button className="btn btn-small btn-secondary" onClick={() => setPaying(r)}>{c.pay}</button>}
                    {Number(r.remaining) === 0 && <Badge tone="ok">Soldée</Badge>}
                    {Number(r.paid) === 0 && can('dues:manage') && <button className="btn btn-small btn-ghost" disabled={act.busy} onClick={() => { if (confirm(`Annuler « ${r.label} » ?`)) act.run(async () => { await del(`/dues/${r.id}`); reload(); }); }}>Annuler</button>}
                  </span></td></tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={kind === 'borrowing' ? 6 : 5}>Somme</td><td className="r">{FR(data.totals.amount)}</td><td className="r">{FR(data.totals.paid)}</td><td className="r">{FR(data.totals.remaining)}</td><td colSpan={2} /></tr></tfoot>
          </table></div>
          <TotalBar items={[['TOTAL', data.totals.amount], [paidL.toUpperCase(), data.totals.paid], [(kind === 'borrowing' ? 'RESTE' : restL.toUpperCase()), data.totals.remaining]]} />
        </>
      )}
      {adding && <DueForm kind={kind} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
      {paying && <PayForm due={paying} verb={c.pay} onClose={() => setPaying(null)} onDone={() => { setPaying(null); reload(); }} />}
    </Card>
  );
}

function DueForm({ kind, onClose, onDone }: { kind: DueKind; onClose: () => void; onDone: () => void }) {
  const c = CFG[kind];
  const partners = useAsync(() => (c.partnerKind ? get<any[]>(`/partners?kind=${c.partnerKind}`) : Promise.resolve([] as any[])), []);
  const accounts = useAsync(() => (kind === 'borrowing' ? get<any[]>('/financial-accounts').catch(() => [] as any[]) : Promise.resolve([] as any[])), []);
  const today = iso(new Date());
  const [f, setF] = useState({ partner: '', ref: '', label: '', issued: today, due: today, qty: '', pu: '', amount: '', principal: '', rate: '', term: '', taxType: kind === 'tax' ? 'BIC' : '', period: String(new Date().getFullYear()), account: '' });
  const [key] = useState(idem());
  const act = useAction();
  const qp = c.unit && f.qty && f.pu && /^\d+(\.\d{1,3})?$/.test(f.qty) && /^\d+(\.\d{1,2})?$/.test(f.pu) ? Math.round(Number(f.qty) * Number(f.pu) * 100) / 100 : null;
  const interest = kind === 'borrowing' && AMT.test(f.principal) && /^\d+(\.\d+)?$/.test(f.rate) && /^\d+$/.test(f.term) ? Math.round(Number(f.principal) * (Number(f.rate) / 100) * (Number(f.term) / 12) * 100) / 100 : null;
  const ok = f.label.trim() && f.due && (kind === 'borrowing' ? interest !== null : (AMT.test(f.amount) || qp !== null)) && (kind !== 'tax' || f.taxType.trim());
  return (
    <Modal title={c.add} onClose={onClose}>
      {c.partner && <Field label={c.partner}><select value={f.partner} onChange={(e) => setF({ ...f, partner: e.target.value })}><option value="">—</option>{(partners.data ?? []).filter((p: any) => p.active).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
      <div className="grid-2"><Field label={c.ref}><input value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} maxLength={40} /></Field>
        <Field label="Date"><input type="date" value={f.issued} onChange={(e) => setF({ ...f, issued: e.target.value })} /></Field></div>
      <Field label="Libellé"><input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} maxLength={200} /></Field>
      {kind === 'tax' && <div className="grid-2"><Field label="Nature (BIC, TVA, patente…)"><input value={f.taxType} onChange={(e) => setF({ ...f, taxType: e.target.value })} maxLength={40} /></Field><Field label="Période"><input value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} maxLength={20} /></Field></div>}
      {kind === 'borrowing' ? (
        <>
          <Field label="Capital emprunté (FCFA)"><input inputMode="decimal" value={f.principal} onChange={(e) => setF({ ...f, principal: e.target.value })} /></Field>
          <div className="grid-2">
            <Field label="Taux annuel (%)"><input inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></Field>
            <Field label="Durée (mois)"><input inputMode="numeric" value={f.term} onChange={(e) => setF({ ...f, term: e.target.value })} /></Field></div>
          {interest !== null && <p className="muted">Intérêts : {FR(interest)} · à rembourser : <strong>{FR(Number(f.principal) + interest)}</strong> FCFA</p>}
          <Field label="Compte qui reçoit les fonds (facultatif)"><select value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })}><option value="">Ne pas passer d'écriture</option>{(accounts.data ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        </>
      ) : (
        <>
          {c.unit && <div className="grid-2"><Field label="Quantité"><input inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field><Field label="Prix unitaire"><input inputMode="decimal" value={f.pu} onChange={(e) => setF({ ...f, pu: e.target.value })} /></Field></div>}
          <Field label={c.unit ? 'Montant (calculé si quantité et prix saisis)' : 'Montant'}><input inputMode="decimal" value={qp !== null ? String(qp) : f.amount} readOnly={qp !== null} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        </>
      )}
      <Field label="Date d'échéance"><input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>
      {act.error && <ErrorBox message={act.error} />}
      <div className="modal-actions"><button className="btn" disabled={act.busy || !ok} onClick={() => act.run(async () => {
        await post('/dues', { idempotency_key: key, kind, label: f.label.trim(), due_date: f.due, issued_on: f.issued, ...(f.partner && { partner_id: f.partner }), ...(f.ref.trim() && { ref_no: f.ref.trim() }),
          ...(kind === 'borrowing' ? { principal: f.principal, rate_pct: f.rate, term_months: f.term, ...(f.account && { account_id: f.account }) } : qp !== null ? { quantity: f.qty, unit_price: f.pu } : { amount: f.amount }),
          ...(kind === 'tax' && { tax_type: f.taxType.trim(), ...(f.period.trim() && { period: f.period.trim() }) }) });
        onDone();
      })}>Enregistrer</button><button className="btn btn-ghost" onClick={onClose}>Annuler</button></div>
    </Modal>
  );
}

function PayForm({ due, verb, onClose, onDone }: { due: any; verb: string; onClose: () => void; onDone: () => void }) {
  const accounts = useAsync(() => get<any[]>('/financial-accounts'), []);
  const [amount, setAmount] = useState(String(Number(due.remaining)));
  const [account, setAccount] = useState('');
  const [paidOn, setPaidOn] = useState(iso(new Date()));
  const [key] = useState(idem());
  const act = useAction();
  const ok = AMT.test(amount) && Number(amount) > 0 && Number(amount) <= Number(due.remaining) && account;
  return (
    <Modal title={`${verb} : ${due.label}`} onClose={onClose}>
      <p>Reste : <strong>{FR(due.remaining)}</strong> FCFA</p>
      <Field label="Montant"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="Compte (caisse ou banque)"><select value={account} onChange={(e) => setAccount(e.target.value)}><option value="">—</option>{(accounts.data ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      <Field label="Date"><input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
      {act.error && <ErrorBox message={act.error} />}
      <div className="modal-actions"><button className="btn" disabled={act.busy || !ok} onClick={() => act.run(async () => { await post(`/dues/${due.id}/payments`, { idempotency_key: key, amount, account_id: account, paid_on: paidOn }); onDone(); })}>{verb}</button>
        <button className="btn btn-ghost" onClick={onClose}>Annuler</button></div>
    </Modal>
  );
}

/** Estimation du BIC d'un exercice : produits − charges des rubriques ci-dessus, au taux saisi. */
export function Bic() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [rate, setRate] = useState('25');
  const { data, loading, error, reload } = useAsync(() => get<any>(`/dues/bic-estimate?year=${year}&rate=${rate}`), [year, rate]);
  return (
    <Card>
      <div className="journal-head"><h2>Estimation de l'impôt BIC</h2><div className="toolbar"><button className="btn btn-secondary" onClick={() => window.print()}>Imprimer</button></div></div>
      <div className="toolbar filters"><label>Exercice <input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 80 }} /></label><label>Taux (%) <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} style={{ width: 70 }} /></label></div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading || !data ? <Loading /> : (
        <>
          <Table rows={[['Prestations', data.services], ['Ventes d\'autres produits', data.other_sales], ['Produits', data.produits], ['Factures des fournisseurs', data.supplier_invoices], ['Intérêts d\'emprunts', data.interest], ['Charges', data.charges], ['Résultat', data.resultat], [`BIC estimé à ${FR(data.rate_pct)} %`, data.bic_estime]]}
            columns={[{ header: 'Rubrique', render: (r) => r[0] }, { header: 'Montant (FCFA)', align: 'right', render: (r) => <strong>{FR(r[1])}</strong> }]} />
          <p className="muted">{data.note}</p>
        </>
      )}
    </Card>
  );
}
