import { useState } from 'react';
import { get, post } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Tabs, useAction, useAsync } from '../ui';

const KG = (v: any) => Number(v ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
const M = (v: any) => Number(v ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const KIND: Record<string, string> = { cooperative: 'Coopérative', exporter: 'Exportateur' };

function Propose({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ code: '' }); const a = useAction();
  return <Modal title="Proposer un lien" onClose={onClose}>
    <Field label="Code de l'autre organisation" hint="Demandez-le à son administrateur"><input value={f.code} autoFocus onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
    <p className="muted">Dès que l'autre organisation accepte, vous devenez automatiquement partenaires : chacune peut livrer à l'autre et recevoir de l'autre.</p>
    {a.error && <p className="error" role="alert">{a.error}</p>}
    <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={a.busy || f.code.length < 2} onClick={() => a.run(async () => { await post('/org-links', { code: f.code }); onDone(); })}>Proposer</button></div>
  </Modal>;
}

/** Coopératives fournisseuses (synthèse des livraisons) et liens avec les autres organisations (exportateurs, coopératives). */
export default function OrganisationsLiees() {
  const { can, org } = useAuth();
  const exporter = org?.kind === 'exporter';
  const [tab, setTab] = useState<'synthese' | 'liens'>(can('deliveries:read') ? 'synthese' : 'liens');
  const sup = useAsync(() => (can('deliveries:read') ? get<any[]>('/deliveries/suppliers') : Promise.resolve([])), []);
  const links = useAsync(() => get<any[]>('/org-links'), []);
  const [adding, setAdding] = useState(false);
  const a = useAction();
  const manage = can('links:manage');
  return (
    <>
      <PageHeader title={exporter ? 'Coopératives' : 'Organisations liées'} subtitle={exporter ? 'Les coopératives qui vous livrent : livraisons, poids acceptés, règlements.' : 'Exportateurs et coopératives avec lesquels vous échangez des livraisons.'}
        actions={manage ? <button className="btn" onClick={() => setAdding(true)}>Proposer un lien</button> : undefined} />
      {can('deliveries:read') && <Tabs tabs={[['synthese', exporter ? 'Coopératives fournisseuses' : 'Fournisseurs'], ['liens', 'Liens']]} value={tab} onChange={setTab} />}
      <Card>
        {a.error && <ErrorBox message={a.error} />}
        {tab === 'synthese' ? (sup.loading ? <Loading /> : !(sup.data ?? []).length ? <Empty>Aucune livraison reçue pour l'instant.</Empty> :
          <div className="table-scroll"><table>
            <thead><tr><th>Coopérative</th><th className="r">Livraisons</th><th className="r">En cours</th><th className="r">Acceptés (kg)</th><th className="r">Rejetés (kg)</th><th className="r">À régler (kg)</th><th className="r">Déjà payé</th></tr></thead>
            <tbody>{(sup.data ?? []).map((s) => <tr key={s.id}><td><strong>{s.name}</strong></td><td className="r">{s.deliveries}</td><td className="r">{s.in_progress}</td><td className="r">{KG(s.accepted_kg)}</td><td className="r">{KG(s.rejected_kg)}</td><td className="r">{KG(s.to_settle_kg)}</td><td className="r">{M(s.paid)}</td></tr>)}</tbody>
          </table></div>) :
          links.loading ? <Loading /> : !(links.data ?? []).length ? <Empty>Aucun lien. {manage ? 'Proposez un lien avec le code de l\'autre organisation.' : ''}</Empty> :
          <div className="table-scroll"><table>
            <thead><tr><th>Organisation</th><th>Type</th><th>Code</th><th>Sens</th><th>Statut</th><th /></tr></thead>
            <tbody>{(links.data ?? []).map((l) => (
              <tr key={l.id}><td><strong>{l.other_name}</strong></td><td>{KIND[l.other_kind] ?? l.other_kind}</td><td><code>{l.other_code}</code></td>
                <td>{l.bidirectional ? 'Dans les deux sens' : l.my_side === 'supplier' ? 'Nous lui livrons' : 'Elle nous livre'}</td>
                <td>{l.status === 'active' ? <Badge tone="ok">Actif</Badge> : <Badge tone="warn">{l.requested_by_me ? 'En attente de l\'autre' : 'À accepter'}</Badge>}</td>
                <td>{manage && <span className="row-actions">
                  {l.status === 'pending' && !l.requested_by_me && <button className="btn btn-small btn-primary" disabled={a.busy} onClick={() => a.run(async () => { await post(`/org-links/${l.id}/accept`); links.reload(); })}>Accepter</button>}
                  <button className="btn btn-small btn-ghost" disabled={a.busy} onClick={() => { if (confirm(`Révoquer le lien avec « ${l.other_name} » ?`)) a.run(async () => { await post(`/org-links/${l.id}/revoke`); links.reload(); }); }}>{l.status === 'pending' && !l.requested_by_me ? 'Refuser' : 'Révoquer'}</button>
                </span>}</td></tr>))}</tbody>
          </table></div>}
      </Card>
      {adding && <Propose onClose={() => setAdding(false)} onDone={() => { setAdding(false); links.reload(); }} />}
    </>
  );
}
