import { useState } from 'react';
import { get, post, put } from '../api';
import { getChains } from '../chains';
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
  const [add, setAdd] = useState(false);
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
            {can('collectors:manage') && can('users:create') && <p><button className="btn" onClick={() => setAdd(true)}>+ Nouveau délégué</button></p>}
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
      {add && <NewDelegate onClose={() => setAdd(false)} onDone={(id) => { setAdd(false); reload(); setSel(id); setTab('info'); }} />}
      {edit && cur && <Edit c={cur} onClose={() => setEdit(false)} onDone={() => { setEdit(false); reload(); }} />}
    </>
  );
}

/** Enregistre un délégué en une fois : compte de connexion, profil (localité, banque, pièce), filières et tarifs. */
function NewDelegate({ onClose, onDone }: { onClose: () => void; onDone: (collectorId: string) => void }) {
  const { can } = useAuth();
  const chains = useAsync(() => getChains().catch(() => [] as any[]), []);
  const [f, setF] = useState({ full_name: '', email: '', phone: '', password: '', member_code: '', origin: '', bank_name: '', bank_account: '', id_doc_type: '', id_doc_no: '', transport: '', retention: '' });
  const [picked, setPicked] = useState<string[]>([]);
  const act = useAction();
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const num = (v: string) => v === '' || /^\d+(\.\d{1,4})?$/.test(v);
  const ok = f.full_name.trim().length >= 2 && f.email.includes('@') && f.password.length >= 10 && f.origin.trim() && num(f.transport) && num(f.retention);
  return (
    <Modal title="Nouveau délégué" onClose={onClose}>
      <div className="grid-2"><Field label="Nom et prénoms"><input value={f.full_name} onChange={set('full_name')} maxLength={200} /></Field>
        <Field label="Code (facultatif)" hint="Attribué automatiquement s'il est vide."><input value={f.member_code} onChange={(e) => setF({ ...f, member_code: e.target.value.toUpperCase() })} maxLength={30} /></Field></div>
      <div className="grid-2"><Field label="Contact (téléphone)"><input inputMode="tel" value={f.phone} onChange={set('phone')} maxLength={30} /></Field>
        <Field label="Localité (provenance des achats)"><input value={f.origin} onChange={set('origin')} maxLength={80} /></Field></div>
      <div className="grid-2"><Field label="E-mail (identifiant de connexion)"><input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Mot de passe provisoire" hint="10 caractères au minimum."><input value={f.password} onChange={set('password')} /></Field></div>
      <div className="grid-2"><Field label="Banque"><input value={f.bank_name} onChange={set('bank_name')} maxLength={80} /></Field>
        <Field label="N° de compte"><input value={f.bank_account} onChange={set('bank_account')} maxLength={40} /></Field></div>
      <div className="grid-2"><Field label="Type de pièce"><select value={f.id_doc_type} onChange={set('id_doc_type')}><option value="">—</option>{Object.entries(DOC).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="N° de la pièce"><input value={f.id_doc_no} onChange={set('id_doc_no')} maxLength={40} /></Field></div>
      {can('collectors:rates') && <div className="grid-2"><Field label="Transport au kilo (FCFA)" hint="Vide : tarif par défaut."><input inputMode="decimal" value={f.transport} onChange={set('transport')} /></Field>
        <Field label="Retenue au kilo (FCFA)" hint="Vide : tarif par défaut."><input inputMode="decimal" value={f.retention} onChange={set('retention')} /></Field></div>}
      <Field label="Filières achetées" hint="Aucune case cochée : toutes les filières de la coopérative.">
        <div className="role-pick">{(chains.data ?? []).map((v: any) => <label key={v.id} className="check"><input type="checkbox" checked={picked.includes(v.id)} onChange={() => setPicked((p) => (p.includes(v.id) ? p.filter((x) => x !== v.id) : [...p, v.id]))} /> {v.name}</label>)}</div></Field>
      {act.error && <ErrorBox message={act.error} />}
      <div className="modal-actions"><button className="btn" disabled={act.busy || !ok} onClick={() => act.run(async () => {
        const roles = await post<any>('/roles/standard', { code: 'collecteur' });
        const u = await post<any>('/users', { email: f.email.trim(), full_name: f.full_name.trim(), ...(f.phone.trim() && { phone: f.phone.trim() }), password: f.password, role_id: roles.id, ...(f.member_code.trim() && { member_code: f.member_code.trim() }) });
        let id = '';
        try {
          const c = await post<any>('/collectors', { user_id: u.id, origin: f.origin.trim() });
          id = c.id;
          const prof: Record<string, string> = {};
          for (const k of ['bank_name', 'bank_account', 'id_doc_type', 'id_doc_no'] as const) if (f[k].trim()) prof[k] = f[k].trim();
          if (Object.keys(prof).length) await put(`/collectors/${id}/profile`, prof);
          for (const v of picked.length ? picked : [null]) await post(`/collectors/${id}/assignments`, v ? { value_chain_id: v } : {});
          if (can('collectors:rates') && (f.transport || f.retention)) await put(`/collectors/${id}/rates`, { ...(f.transport && { transport_per_kg: f.transport }), ...(f.retention && { retention_per_kg: f.retention }) });
        } catch (e: any) {
          throw new Error(`Le compte de ${f.full_name.trim()} est créé, mais sa fiche est incomplète (${e?.message ?? e}). Ouvrez-la dans la liste puis cliquez sur « Modifier la fiche ».`);
        }
        onDone(id);
      })}>Enregistrer le délégué</button><button className="btn btn-ghost" onClick={onClose}>Annuler</button></div>
    </Modal>
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
