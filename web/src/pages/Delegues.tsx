import { useState } from 'react';
import { del, get, post, put } from '../api';
import { getChains } from '../chains';
import { useAuth } from '../auth';
import { ErrorBox, Field, Loading, Modal, Tabs, useAction, useAsync } from '../ui';
import { FicheRow, Registre } from '../Registre';
import { Fiche } from './Convois';
import { PhotoBox, PhotoPick, uploadPhoto } from '../Photo';
import { RTYPE } from './Rapports';

const DOC: Record<string, string> = { cni: "Carte nationale d'identité", passeport: 'Passeport', attestation: "Attestation d'identité", permis: 'Permis de conduire', autre: 'Autre pièce' };
type Tab = 'info' | 'id' | 'transport' | 'retenues' | 'account';

/** Délégués : liste en haut (une ligne par délégué), boutons à droite, fiche à onglets en dessous. */
export default function Delegues() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/collectors'), []);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('info');
  const [edit, setEdit] = useState(false);
  const [add, setAdd] = useState(false);
  const off = useAction();
  const rows = (data ?? []).filter((c) => !q.trim() || `${c.member_code ?? ''} ${c.full_name} ${c.origin ?? ''} ${c.phone ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const cur = (data ?? []).find((c) => c.id === sel) ?? rows[0] ?? null;
  const tabs: [Tab, string][] = [['info', 'Infos personnelles'], ['transport', 'Transport'], ['retenues', 'Retenues (mise en compte)'], ['id', "Pièce d'identité"]];
  if (can('convoys:settle')) tabs.push(['account', 'Compte et solde']);
  return (
    <>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : (
        <Registre title="Délégués" subtitle="Fiche de chaque délégué : identité, localité, contact, banque, pièce d'identité et compte."
          rows={rows} selectedId={cur?.id ?? null} onSelect={(c) => { setSel(c.id); }} rowClass={(c) => (c.status !== 'active' ? 'off' : undefined)} empty="Aucun délégué."
          toolbar={<input type="search" placeholder="Rechercher (code, nom, localité, contact)" aria-label="Rechercher un délégué" value={q} onChange={(e) => setQ(e.target.value)} />}
          columns={[
            { header: 'Code', render: (c) => <code>{c.member_code ?? '—'}</code> }, { header: 'Nom', render: (c) => c.full_name },
            { header: 'Localité', render: (c) => c.origin ?? '' }, { header: 'Contact', render: (c) => c.phone ?? '' },
            { header: 'Banque', render: (c) => c.bank_name ?? '' }, { header: 'Pièce', render: (c) => DOC[c.id_doc_type] ?? '' }, { header: 'N° pièce', render: (c) => c.id_doc_no ?? '' },
          ]}
          actions={<>
            {can('collectors:manage') && can('users:create') && <button className="btn" onClick={() => setAdd(true)}>Nouveau</button>}
            {can('collectors:manage') && <button className="btn btn-secondary" disabled={!cur} onClick={() => setEdit(true)}>Modifier</button>}
            {can('collectors:manage') && <button className="btn btn-secondary" disabled={!cur || cur.status !== 'active' || off.busy} onClick={() => { if (cur && window.confirm(`Désactiver ${cur.full_name} ? Son historique est conservé.`)) off.run(async () => { await post(`/collectors/${cur.id}/disable`); reload(); }); }}>Désactiver</button>}
            <button className="btn btn-secondary" onClick={() => window.print()}>Imprimer</button>
            {off.error && <ErrorBox message={off.error} />}
          </>}>
          {!cur ? <p className="muted">Choisissez un délégué dans la liste.</p> : (
            <>
              <Tabs tabs={tabs} value={tab} onChange={setTab} />
              {tab === 'info' && (
                <div className="fiche-with-photo"><PhotoBox type="user" id={cur.user_id} name={cur.full_name} canEdit={can('collectors:manage')} />
                <div className="fiche-form">
                  <FicheRow label="Code">{cur.member_code ?? '—'}</FicheRow><FicheRow label="Nom">{cur.full_name}</FicheRow>
                  <FicheRow label="Localité">{cur.origin ?? '—'}</FicheRow><FicheRow label="Contact">{cur.phone ?? '—'}</FicheRow>
                  <FicheRow label="E-mail">{!cur.email || cur.email.endsWith('@agritrace.invalid') ? 'Sans accès à l\'application' : cur.email}</FicheRow><FicheRow label="Statut">{cur.status === 'active' ? 'Actif' : 'Désactivé'}</FicheRow>
                  <FicheRow label="Banque">{cur.bank_name ?? '—'}</FicheRow><FicheRow label="N° de compte">{cur.bank_account ?? '—'}</FicheRow>
                  <FicheRow label="Produits"><ChainsOf c={cur} onDone={reload} /></FicheRow>
                </div></div>
              )}
              {tab === 'id' && <div className="fiche-form"><FicheRow label="Type de pièce">{DOC[cur.id_doc_type] ?? '—'}</FicheRow><FicheRow label="N° de la pièce">{cur.id_doc_no ?? '—'}</FicheRow></div>}
              {(tab === 'transport' || tab === 'retenues') && <Rates c={cur} kind={tab} onDone={reload} />}
              {tab === 'account' && <Fiche collectorId={cur.id} />}
            </>
          )}
        </Registre>
      )}
      {add && <NewDelegate onClose={() => setAdd(false)} onDone={(id) => { setAdd(false); reload(); setSel(id); setTab('info'); }} />}
      {edit && cur && <Edit c={cur} onClose={() => setEdit(false)} onDone={() => { setEdit(false); reload(); }} />}
    </>
  );
}

/** Produits achetés par le délégué : ajout et retrait ; chaque produit peut avoir ses propres tarifs (onglets Transport et Retenues). */
function ChainsOf({ c, onDone }: { c: any; onDone: () => void }) {
  const { can } = useAuth();
  const chains = useAsync(() => getChains().catch(() => [] as any[]), []);
  const act = useAction();
  const [pick, setPick] = useState('');
  const list: any[] = c.assignments ?? [];
  const name = (id: string | null) => (id ? (chains.data ?? []).find((x: any) => x.id === id)?.name ?? '…' : 'Tous les produits');
  const free = (chains.data ?? []).filter((x: any) => !list.some((a) => a.value_chain_id === x.id));
  const may = can('collectors:manage');
  return (
    <div>
      {list.length === 0 && <span className="muted">Aucun (tous les produits)</span>}
      {list.map((a) => <span key={a.id} className="chip">{name(a.value_chain_id)}{may && <button type="button" className="chip-x" aria-label={`Retirer ${name(a.value_chain_id)}`} disabled={act.busy} onClick={() => act.run(async () => { await del(`/collectors/${c.id}/assignments/${a.id}`); onDone(); })}> ×</button>}</span>)}
      {may && free.length > 0 && <span style={{ display: 'inline-flex', gap: '.4rem', marginLeft: '.5rem' }}>
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Ajouter un produit"><option value="">+ Ajouter un produit…</option>{free.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <button type="button" className="btn btn-small" disabled={!pick || act.busy} onClick={() => act.run(async () => { await post(`/collectors/${c.id}/assignments`, { value_chain_id: pick }); setPick(''); onDone(); })}>Ajouter</button></span>}
      {act.error && <ErrorBox message={act.error} />}
    </div>
  );
}

/** Enregistre un délégué en une fois : compte de connexion, profil (localité, banque, pièce), filières et tarifs. */
function NewDelegate({ onClose, onDone }: { onClose: () => void; onDone: (collectorId: string) => void }) {
  const chains = useAsync(() => getChains().catch(() => [] as any[]), []);
  const [f, setF] = useState({ last_name: '', first_names: '', member_code: '', email: '', phone: '', password: '', origin: '', bank_name: '', bank_account: '', id_doc_type: '', id_doc_no: '' });
  const [picked, setPicked] = useState<string[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const act = useAction();
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const codeOk = /^[A-Z0-9][A-Z0-9-]{1,29}$/.test(f.member_code.trim());
  // Seuls le nom, les prénoms et le code sont obligatoires ; un accès à l'application demande à la fois un e-mail et un mot de passe.
  const accessOk = (!f.email.trim() && !f.password) || (f.email.includes('@') && f.password.length >= 10);
  const ok = f.last_name.trim() && f.first_names.trim() && codeOk && accessOk;
  const full = `${f.last_name.trim()} ${f.first_names.trim()}`;
  return (
    <Modal title="Nouveau délégué" onClose={onClose}>
      <div className="new-person"><PhotoPick file={photo} onChange={setPhoto} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="grid-2"><Field label="Nom *"><input value={f.last_name} onChange={set('last_name')} maxLength={100} /></Field>
            <Field label="Prénoms *"><input value={f.first_names} onChange={set('first_names')} maxLength={100} /></Field></div>
          <Field label="Code *" hint="2 à 30 caractères : majuscules, chiffres et tirets."><input value={f.member_code} onChange={(e) => setF({ ...f, member_code: e.target.value.toUpperCase() })} maxLength={30} /></Field>
        </div></div>
      <p className="muted" style={{ margin: '.2rem 0 .6rem' }}>Les autres informations sont facultatives et pourront être complétées plus tard.</p>
      <div className="grid-2"><Field label="Contact (téléphone)"><input inputMode="tel" value={f.phone} onChange={set('phone')} maxLength={30} /></Field>
        <Field label="Localité (provenance des achats)"><input value={f.origin} onChange={set('origin')} maxLength={80} /></Field></div>
      <div className="grid-2"><Field label="E-mail (accès à l'application)" hint="Vide : le délégué est enregistré sans accès."><input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Mot de passe provisoire" hint="10 caractères au minimum, avec l'e-mail."><input value={f.password} onChange={set('password')} /></Field></div>
      <div className="grid-2"><Field label="Banque"><input value={f.bank_name} onChange={set('bank_name')} maxLength={80} /></Field>
        <Field label="N° de compte"><input value={f.bank_account} onChange={set('bank_account')} maxLength={40} /></Field></div>
      <div className="grid-2"><Field label="Type de pièce"><select value={f.id_doc_type} onChange={set('id_doc_type')}><option value="">—</option>{Object.entries(DOC).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="N° de la pièce"><input value={f.id_doc_no} onChange={set('id_doc_no')} maxLength={40} /></Field></div>
      <Field label="Produits achetés" hint="Aucune case cochée : tous les produits de la coopérative.">
        <div className="role-pick">{(chains.data ?? []).map((v: any) => <label key={v.id} className="check"><input type="checkbox" checked={picked.includes(v.id)} onChange={() => setPicked((p) => (p.includes(v.id) ? p.filter((x) => x !== v.id) : [...p, v.id]))} />{v.name}</label>)}</div></Field>
      {act.error && <ErrorBox message={act.error} />}
      <div className="modal-actions"><button className="btn" disabled={act.busy || !ok} onClick={() => act.run(async () => {
        const roles = await post<any>('/roles/standard', { code: 'collecteur' });
        const hasAccess = !!f.email.trim() && !!f.password;
        const u = await post<any>('/users', { full_name: full, ...(hasAccess && { email: f.email.trim(), password: f.password }), ...(f.phone.trim() && { phone: f.phone.trim() }), role_id: roles.id, member_code: f.member_code.trim() });
        let id = '';
        try {
          const c = await post<any>('/collectors', { user_id: u.id, ...(f.origin.trim() && { origin: f.origin.trim() }) });
          id = c.id;
          const prof: Record<string, string> = {};
          for (const k of ['bank_name', 'bank_account', 'id_doc_type', 'id_doc_no'] as const) if (f[k].trim()) prof[k] = f[k].trim();
          if (Object.keys(prof).length) await put(`/collectors/${id}/profile`, prof);
          for (const v of picked.length ? picked : [null]) await post(`/collectors/${id}/assignments`, v ? { value_chain_id: v } : {});
          if (photo) await uploadPhoto('user', u.id, photo);
        } catch (e: any) {
          throw new Error(`${full} est enregistré, mais sa fiche est incomplète (${e?.message ?? e}). Ouvrez-la dans la liste puis cliquez sur « Modifier ».`);
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
      <div className="modal-actions"><button className="btn" disabled={act.busy} onClick={() => act.run(async () => { await put(`/collectors/${c.id}/profile`, f); onDone(); })}>Enregistrer</button><button className="btn btn-ghost" onClick={onClose}>Annuler</button></div>
    </Modal>
  );
}

/** Onglets Transport et Retenues : tarifs au kilo préenregistrés dans le profil du délégué (général, puis propres à chaque produit acheté) ; seul l'administrateur les saisit, la caisse les reprend. */
function Rates({ c, kind, onDone }: { c: any; kind: 'transport' | 'retenues'; onDone: () => void }) {
  const { can } = useAuth();
  const field = kind === 'transport' ? 'transport_per_kg' : 'retention_per_kg';
  const cfg = useAsync(() => get<any>('/convoys/settings').catch(() => null), []);
  const chains = useAsync(() => getChains().catch(() => [] as any[]), []); // produits (filières) définis par la coopérative
  const [edits, setEdits] = useState<Record<string, string>>({}); // valeurs modifiées, par produit, pas encore enregistrées
  const [ty, setTy] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const def = kind === 'transport' ? cfg.data?.transport_unit : cfg.data?.retention_per_kg;
  const may = can('collectors:rates');
  const num = (x: string) => x === '' || /^\d+(\.\d{1,4})?$/.test(x);
  const assigned: any[] = c.assignments ?? [];
  const covered = (id: string) => assigned.length === 0 || assigned.some((a) => !a.value_chain_id || a.value_chain_id === id);
  const list: any[] = (chains.data ?? []).filter((x: any) => covered(x.id)); // seuls les produits ajoutés au profil du délégué (aucun ajouté = tous)
  const saved = (id: string) => { const r = (c.rates ?? []).find((x: any) => x.value_chain_id === id); return r?.[field] != null ? String(Number(r[field])) : ''; };
  const label = kind === 'transport' ? 'Coût de transport au kilo (FCFA)' : 'Retenue au kilo — mise en compte (FCFA)';
  const save = (id: string) => run(async () => {
    // Le produit rejoint ceux du délégué si elle n'y figure pas encore.
    if (!covered(id)) await post(`/collectors/${c.id}/assignments`, { value_chain_id: id });
    await put(`/collectors/${c.id}/rates`, { value_chain_id: id, [field]: edits[id] === '' ? null : edits[id] });
    setEdits((e) => { const { [id]: _drop, ...rest } = e; return rest; }); onDone();
  });
  return (
    <div>
      <p className="muted">{kind === 'transport'
        ? 'Modifiez ci-dessous le coût de transport au kilo de ce délégué, produit par produit : la caisse le reprend à chaque règlement, sans pouvoir le modifier. Une case vide = tarif par défaut de la coopérative.'
        : 'Modifiez ci-dessous la retenue au kilo de ce délégué, produit par produit : elle s\'accumule en mise en compte et est reversée à la clôture de son compte, après approbation de l\'administrateur. Une case vide = tarif par défaut de la coopérative.'}</p>
      {list.length === 0 && !chains.loading && <p className="muted">Aucun produit : définissez-les d'abord dans Produits, puis ajoutez-les au profil du délégué (Infos personnelles).</p>}
      {list.length > 0 && assigned.length > 0 && <p className="muted">Seuls les produits ajoutés au profil du délégué figurent ici (Infos personnelles › Produits).</p>}
      {list.length > 0 && (
        <div className="table-wrap"><table>
          <thead><tr><th>Produit</th><th className="num">{label}</th><th></th></tr></thead>
          <tbody>{list.map((x: any) => {
            const val = edits[x.id] ?? saved(x.id), dirty = edits[x.id] !== undefined && edits[x.id] !== saved(x.id);
            return (
              <tr key={x.id}>
                <td><strong>{x.name}</strong></td>
                <td className="num"><input aria-label={`${label} — ${x.name}`} inputMode="decimal" style={{ width: '9rem', textAlign: 'right' }} value={val} placeholder={`défaut : ${Number(def ?? 0).toLocaleString('fr-FR')}`} readOnly={!may} disabled={!may} onChange={(e) => setEdits((p) => ({ ...p, [x.id]: e.target.value }))} /></td>
                <td>{may && <button className="btn btn-small" disabled={busy || !dirty || !num(val)} onClick={() => save(x.id)}>Enregistrer</button>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {kind === 'retenues' && <Field label="Type de prélèvement" hint="Nature de la retenue au kilo ; reprise sur chaque règlement et dans le journal d'approvisionnement."><select value={ty ?? c.retention_type ?? 'mise_en_compte'} disabled={!may} onChange={(e) => setTy(e.target.value)}>{Object.entries(RTYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>}
      {error && <ErrorBox message={error} />}
      {may && kind === 'retenues' && <p><button className="btn" disabled={busy || ty === null} onClick={() => run(async () => { await put(`/collectors/${c.id}/rates`, { retention_type: ty }); setTy(null); onDone(); })}>Enregistrer le type de prélèvement</button></p>}
      {!may && <p className="muted">Seul l'administrateur de la coopérative saisit ces tarifs.</p>}
    </div>
  );
}
