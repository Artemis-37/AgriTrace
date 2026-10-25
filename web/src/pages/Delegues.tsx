import { useState } from 'react';
import { del, get, post, put } from '../api';
import { getChains } from '../chains';
import { useAuth } from '../auth';
import { ErrorBox, Field, Loading, Modal, Tabs, useAction, useAsync } from '../ui';
import { FicheRow, Registre } from '../Registre';
import { Fiche } from './Convois';
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
                <div className="fiche-form">
                  <FicheRow label="Code">{cur.member_code ?? '—'}</FicheRow><FicheRow label="Nom">{cur.full_name}</FicheRow>
                  <FicheRow label="Localité">{cur.origin ?? '—'}</FicheRow><FicheRow label="Contact">{cur.phone ?? '—'}</FicheRow>
                  <FicheRow label="E-mail">{cur.email ?? '—'}</FicheRow><FicheRow label="Statut">{cur.status === 'active' ? 'Actif' : 'Désactivé'}</FicheRow>
                  <FicheRow label="Banque">{cur.bank_name ?? '—'}</FicheRow><FicheRow label="N° de compte">{cur.bank_account ?? '—'}</FicheRow>
                  <FicheRow label="Filières"><ChainsOf c={cur} onDone={reload} /></FicheRow>
                </div>
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

/** Filières achetées par le délégué : ajout et retrait ; chaque filière peut avoir ses propres tarifs (onglets Transport et Retenues). */
function ChainsOf({ c, onDone }: { c: any; onDone: () => void }) {
  const { can } = useAuth();
  const chains = useAsync(() => getChains().catch(() => [] as any[]), []);
  const act = useAction();
  const [pick, setPick] = useState('');
  const list: any[] = c.assignments ?? [];
  const name = (id: string | null) => (id ? (chains.data ?? []).find((x: any) => x.id === id)?.name ?? '…' : 'Toutes les filières');
  const free = (chains.data ?? []).filter((x: any) => !list.some((a) => a.value_chain_id === x.id));
  const may = can('collectors:manage');
  return (
    <div>
      {list.length === 0 && <span className="muted">Aucune (toutes les filières)</span>}
      {list.map((a) => <span key={a.id} className="chip">{name(a.value_chain_id)}{may && <button type="button" className="chip-x" aria-label={`Retirer ${name(a.value_chain_id)}`} disabled={act.busy} onClick={() => act.run(async () => { await del(`/collectors/${c.id}/assignments/${a.id}`); onDone(); })}> ×</button>}</span>)}
      {may && free.length > 0 && <span style={{ display: 'inline-flex', gap: '.4rem', marginLeft: '.5rem' }}>
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Ajouter une filière"><option value="">+ Ajouter une filière…</option>{free.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <button type="button" className="btn btn-small" disabled={!pick || act.busy} onClick={() => act.run(async () => { await post(`/collectors/${c.id}/assignments`, { value_chain_id: pick }); setPick(''); onDone(); })}>Ajouter</button></span>}
      {act.error && <ErrorBox message={act.error} />}
    </div>
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

/** Onglets Transport et Retenues : tarifs au kilo préenregistrés dans le profil du délégué (général, puis propres à chaque filière achetée) ; seul l'administrateur les saisit, la caisse les reprend. */
function Rates({ c, kind, onDone }: { c: any; kind: 'transport' | 'retenues'; onDone: () => void }) {
  const { can } = useAuth();
  const field = kind === 'transport' ? 'transport_per_kg' : 'retention_per_kg';
  const cfg = useAsync(() => get<any>('/convoys/settings').catch(() => null), []);
  const chains = useAsync(() => getChains().catch(() => [] as any[]), []);
  const [v, setV] = useState<string | null>(null);
  const [byChain, setByChain] = useState<Record<string, string>>({});
  const [ty, setTy] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const own = c[field];
  const def = kind === 'transport' ? cfg.data?.transport_unit : cfg.data?.retention_per_kg;
  const shown = v ?? (own != null ? String(Number(own)) : '');
  const may = can('collectors:rates');
  const num = (x: string) => x === '' || /^\d+(\.\d{1,4})?$/.test(x);
  // Filières du délégué : celles qui lui sont affectées (une affectation sans filière = toutes).
  const assigned: any[] = c.assignments ?? [];
  const allChains = assigned.length === 0 || assigned.some((a) => !a.value_chain_id);
  const mine = (chains.data ?? []).filter((x: any) => allChains || assigned.some((a) => a.value_chain_id === x.id));
  const saved = (id: string) => { const r = (c.rates ?? []).find((x: any) => x.value_chain_id === id); return r?.[field] != null ? String(Number(r[field])) : ''; };
  const cur = (id: string) => byChain[id] ?? saved(id);
  const dirtyChains = mine.filter((x: any) => byChain[x.id] !== undefined && byChain[x.id] !== saved(x.id));
  const ok = num(shown) && dirtyChains.every((x: any) => num(byChain[x.id]));
  const label = kind === 'transport' ? 'Coût de transport au kilo (FCFA)' : 'Retenue au kilo — mise en compte (FCFA)';
  return (
    <div>
      <p className="muted">{kind === 'transport'
        ? 'Le coût de transport de ce délégué est préenregistré ici : la caisse le reprend à chaque règlement, sans pouvoir le modifier.'
        : 'La somme retenue au kilo sur chaque règlement de ce délégué s\'accumule en mise en compte ; elle est reversée à la clôture de son compte, après approbation de l\'administrateur.'}</p>
      <Field label={mine.length > 1 ? `${label} — tarif général` : label} hint={own == null ? `Non renseigné : tarif par défaut de la coopérative (${Number(def ?? 0).toLocaleString('fr-FR')})` : mine.length > 1 ? 'Appliqué aux filières sans tarif propre ci-dessous.' : undefined}>
        <input inputMode="decimal" value={shown} readOnly={!may} disabled={!may} onChange={(e) => setV(e.target.value)} /></Field>
      {mine.length > 1 && (
        <>
          <h4>Tarif par filière</h4>
          <p className="muted">Ce délégué achète plusieurs filières : fixez ici un tarif propre à chacune. Une case vide reprend le tarif général.</p>
          <div className="grid-2">
            {mine.map((x: any) => (
              <Field key={x.id} label={x.name} hint={saved(x.id) === '' && byChain[x.id] === undefined ? `Tarif général (${shown === '' ? Number(def ?? 0).toLocaleString('fr-FR') : Number(shown).toLocaleString('fr-FR')})` : undefined}>
                <input inputMode="decimal" value={cur(x.id)} readOnly={!may} disabled={!may} onChange={(e) => setByChain({ ...byChain, [x.id]: e.target.value })} aria-label={`${label} — ${x.name}`} /></Field>
            ))}
          </div>
        </>
      )}
      {kind === 'retenues' && <Field label="Type de prélèvement" hint="Nature de la retenue au kilo ; reprise sur chaque règlement et dans le journal d'approvisionnement."><select value={ty ?? c.retention_type ?? 'mise_en_compte'} disabled={!may} onChange={(e) => setTy(e.target.value)}>{Object.entries(RTYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>}
      {error && <ErrorBox message={error} />}
      {may ? <p><button className="btn" disabled={busy || (v === null && ty === null && dirtyChains.length === 0) || !ok} onClick={() => run(async () => {
        if (v !== null || ty !== null) await put(`/collectors/${c.id}/rates`, { ...(v !== null && { [field]: shown === '' ? null : shown }), ...(ty !== null && { retention_type: ty }) });
        for (const x of dirtyChains) await put(`/collectors/${c.id}/rates`, { value_chain_id: x.id, [field]: byChain[x.id] === '' ? null : byChain[x.id] });
        setV(null); setTy(null); setByChain({}); onDone();
      })}>Enregistrer</button></p>
        : <p className="muted">Seul l'administrateur de la coopérative saisit ces tarifs.</p>}
    </div>
  );
}
