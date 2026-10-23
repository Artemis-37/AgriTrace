import { useState } from 'react';
import { get, put } from '../api';
import { useAuth } from '../auth';
import { Card, ErrorBox, Field, Loading, Modal, PageHeader, Tabs, useAction, useAsync } from '../ui';
import { Fiche } from './Convois';
import { RTYPE } from './Rapports';

const DOC: Record<string, string> = { cni: "Carte nationale d'identité", passeport: 'Passeport', attestation: "Attestation d'identité", permis: 'Permis de conduire', autre: 'Autre pièce' };
type Tab = 'info' | 'id' | 'transport' | 'retenues' | 'account';

/** Fiche des délégués : liste à gauche (recherche par code ou nom), fiche à onglets à droite. */
export default function Delegues() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/collectors'), []);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('info');
  const [edit, setEdit] = useState(false);
  const rows = (data ?? []).filter((c) => !q.trim() || `${c.member_code ?? ''} ${c.full_name}`.toLowerCase().includes(q.trim().toLowerCase()));
  const cur = (data ?? []).find((c) => c.id === sel) ?? null;
  const tabs: [Tab, string][] = [['info', 'Informations personnelles'], ['id', "Pièce d'identité"]];
  tabs.push(['transport', 'Transport'], ['retenues', 'Retenues (mise en compte)']);
  if (can('convoys:settle')) tabs.push(['account', 'Compte et solde']);
  return (
    <>
      <PageHeader title="Délégués" subtitle="Fiche de chaque délégué : identité, localité, contact, banque, pièce d'identité et compte." />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : (
        <div className="caisse-layout" style={{ gridTemplateColumns: '18rem 1fr' }}>
          <Card>
            <input type="search" className="search-full" placeholder="Rechercher par code ou nom" aria-label="Rechercher un délégué" value={q} onChange={(e) => setQ(e.target.value)} />
            <ul className="plain pick-list">
              {rows.map((c) => <li key={c.id}><button className={sel === c.id ? 'on' : ''} onClick={() => { setSel(c.id); setTab('info'); }}><code>{c.member_code ?? '—'}</code> {c.full_name}{c.status !== 'active' ? ' (désactivé)' : ''}</button></li>)}
              {!rows.length && <li className="muted">Aucun délégué.</li>}
            </ul>
          </Card>
          <div className="caisse-main">
            {!cur ? <Card><p className="muted">Choisissez un délégué dans la liste.</p></Card> : (
              <Card title={`${cur.member_code ?? ''} ${cur.full_name}`.trim()}>
                <Tabs tabs={tabs} value={tab} onChange={setTab} />
                {tab === 'info' && (
                  <dl className="fiche">
                    <dt>Code</dt><dd>{cur.member_code ?? '—'}</dd><dt>Nom</dt><dd>{cur.full_name}</dd>
                    <dt>Localité (provenance)</dt><dd>{cur.origin ?? '—'}</dd><dt>Contact</dt><dd>{cur.phone ?? '—'}</dd><dt>E-mail</dt><dd>{cur.email ?? '—'}</dd>
                    <dt>Banque</dt><dd>{cur.bank_name ?? '—'}</dd><dt>N° de compte</dt><dd>{cur.bank_account ?? '—'}</dd>
                  </dl>
                )}
                {tab === 'id' && <dl className="fiche"><dt>Type de pièce</dt><dd>{DOC[cur.id_doc_type] ?? '—'}</dd><dt>N° de la pièce</dt><dd>{cur.id_doc_no ?? '—'}</dd></dl>}
                {(tab === 'transport' || tab === 'retenues') && <Rates c={cur} kind={tab} onDone={reload} />}
                {tab === 'account' && <Fiche collectorId={cur.id} />}
                {['info', 'id'].includes(tab) && can('collectors:manage') && <p><button className="btn" onClick={() => setEdit(true)}>Modifier la fiche</button></p>}
              </Card>
            )}
          </div>
        </div>
      )}
      {edit && cur && <Edit c={cur} onClose={() => setEdit(false)} onDone={() => { setEdit(false); reload(); }} />}
    </>
  );
}

function Edit({ c, onClose, onDone }: { c: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ origin: c.origin ?? '', bank_name: c.bank_name ?? '', bank_account: c.bank_account ?? '', id_doc_type: c.id_doc_type ?? '', id_doc_no: c.id_doc_no ?? '' });
  const act = useAction();
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={`Fiche de ${c.full_name}`} onClose={onClose}>
      <Field label="Localité (provenance des achats)" hint="Reprise sur les prochains bulletins de pesée."><input value={f.origin} onChange={set('origin')} maxLength={80} /></Field>
      <div className="grid-2"><Field label="Banque"><input value={f.bank_name} onChange={set('bank_name')} maxLength={80} /></Field><Field label="N° de compte"><input value={f.bank_account} onChange={set('bank_account')} maxLength={40} /></Field>
        <Field label="Type de pièce"><select value={f.id_doc_type} onChange={set('id_doc_type')}><option value="">—</option>{Object.entries(DOC).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="N° de la pièce"><input value={f.id_doc_no} onChange={set('id_doc_no')} maxLength={40} /></Field></div>
      {act.error && <ErrorBox message={act.error} />}
      <div className="modal-actions"><button className="btn" disabled={act.busy || !f.origin.trim()} onClick={() => act.run(async () => { await put(`/collectors/${c.id}/profile`, f); onDone(); })}>Enregistrer</button><button className="btn btn-ghost" onClick={onClose}>Annuler</button></div>
    </Modal>
  );
}

/** Onglets Transport et Retenues : tarifs au kilo préenregistrés dans le profil du délégué ; seul l'administrateur les saisit, la caisse les reprend. */
function Rates({ c, kind, onDone }: { c: any; kind: 'transport' | 'retenues'; onDone: () => void }) {
  const { can } = useAuth();
  const field = kind === 'transport' ? 'transport_per_kg' : 'retention_per_kg';
  const cfg = useAsync(() => get<any>('/convoys/settings').catch(() => null), []);
  const [v, setV] = useState<string | null>(null);
  const [ty, setTy] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const own = c[field];
  const def = kind === 'transport' ? cfg.data?.transport_unit : cfg.data?.retention_per_kg;
  const shown = v ?? (own != null ? String(Number(own)) : '');
  const may = can('collectors:rates');
  const ok = shown === '' || /^\d+(\.\d{1,4})?$/.test(shown);
  const label = kind === 'transport' ? 'Coût de transport au kilo (FCFA)' : 'Retenue au kilo — mise en compte (FCFA)';
  return (
    <div>
      <p className="muted">{kind === 'transport'
        ? 'Le coût de transport de ce délégué est préenregistré ici : la caisse le reprend à chaque règlement, sans pouvoir le modifier.'
        : 'La somme retenue au kilo sur chaque règlement de ce délégué s\'accumule en mise en compte ; elle est reversée à la clôture de son compte, après approbation de l\'administrateur.'}</p>
      <Field label={label} hint={own == null ? `Non renseigné : tarif par défaut de la coopérative (${Number(def ?? 0).toLocaleString('fr-FR')})` : undefined}>
        <input inputMode="decimal" value={shown} readOnly={!may} disabled={!may} onChange={(e) => setV(e.target.value)} /></Field>
      {kind === 'retenues' && <Field label="Type de prélèvement" hint="Nature de la retenue au kilo ; reprise sur chaque règlement et dans le journal d'approvisionnement."><select value={ty ?? c.retention_type ?? 'mise_en_compte'} disabled={!may} onChange={(e) => setTy(e.target.value)}>{Object.entries(RTYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>}
      {error && <ErrorBox message={error} />}
      {may ? <p><button className="btn" disabled={busy || (v === null && ty === null) || !ok} onClick={() => run(async () => { await put(`/collectors/${c.id}/rates`, { ...(v !== null && { [field]: shown === '' ? null : shown }), ...(ty !== null && { retention_type: ty }) }); setV(null); setTy(null); onDone(); })}>Enregistrer</button></p>
        : <p className="muted">Seul l'administrateur de la coopérative saisit ces tarifs.</p>}
    </div>
  );
}
