import { FormEvent, useEffect, useState } from 'react';
import { ApiError, download, get, post, postForm, put } from '../api';
import { getChains } from '../chains';
import { useAuth } from '../auth';
import { PRODUCER_STATUS } from '../format';
import { ProducerProfile } from './Affectations';
import { Empty, ErrorBox, Field, Loading, Modal, StatusBadge, Table, Tabs, useAction, useAsync } from '../ui';
import { FicheRow, Registre } from '../Registre';
import { PhotoBox, PhotoPick, uploadPhoto } from '../Photo';

const ID_DOC: Record<string, string> = { cni: "Carte nationale d'identité", passeport: 'Passeport', attestation: "Attestation d'identité", permis: 'Permis de conduire', autre: 'Autre pièce' };
const SEX: Record<string, string> = { male: 'M', female: 'F' };
type PTab = 'info' | 'id' | 'plantations' | 'suivi';

/** Producteurs : liste en haut, boutons à droite, fiche à onglets en dessous (même présentation que les délégués). */
export default function Producers() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [section, setSection] = useState('');
  const [chain, setChain] = useState('');
  const [limit, setLimit] = useState(100);
  useEffect(() => { const t = setTimeout(() => { setQd(q.trim()); setLimit(100); }, 250); return () => clearTimeout(t); }, [q]);
  const sections = useAsync(() => get<{ section: string; producers: number }[]>('/producers/sections').catch(() => []), []);
  const chains = useAsync(() => getChains().catch(() => [] as any[]), []);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [chg, setChg] = useState<any | null>(null);
  const [prof, setProf] = useState<any | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<PTab>('info');
  // Recherche et filtres faits par le serveur (toute la liste, pas seulement les premiers producteurs).
  const { data, loading, error, reload } = useAsync(
    () => get<any[]>(`/producers?limit=${limit}${qd ? `&q=${encodeURIComponent(qd)}` : ''}${section ? `&section=${encodeURIComponent(section)}` : ''}${chain ? `&value_chain_id=${chain}` : ''}`), [qd, section, chain, limit]);
  const rows = data ?? [];
  const cur = rows.find((p) => p.id === sel) ?? rows[0] ?? null;
  const detail = useAsync(() => (cur ? get<any>(`/producers/${cur.id}`).catch(() => null) : Promise.resolve(null)), [cur?.id, data]);
  const plots = useAsync(() => (cur && tab === 'plantations' ? get<any[]>(`/parcels?producer_id=${cur.id}`).catch(() => []) : Promise.resolve([] as any[])), [cur?.id, tab]);
  const chainName = (id: string) => (chains.data ?? []).find((x: any) => x.id === id)?.name ?? '…';
  const num = (v: any, d = 2) => (v != null && v !== '' ? Number(v).toLocaleString('fr-FR', { maximumFractionDigits: d }) : '—');
  const tabs: [PTab, string][] = [['info', 'Infos personnelles'], ['id', "Pièce d'identité"], ['plantations', 'Plantations'], ['suivi', 'Formations et tâches']];
  return (
    <>
      {error && <ErrorBox message={error} onRetry={reload} />}
      <Registre title="Producteurs" subtitle="Registre des producteurs de la coopérative" rows={rows} selectedId={cur?.id ?? null} onSelect={(p) => setSel(p.id)} empty="Aucun producteur trouvé."
        count={rows.length}
        toolbar={<>
          <select aria-label="Filtrer par filière" value={chain} onChange={(e) => { setChain(e.target.value); setLimit(100); }}><option value="">Toutes les filières</option>{(chains.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input type="search" aria-label="Rechercher" placeholder="Rechercher (nom, code, téléphone)" value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label="Filtrer par section" value={section} onChange={(e) => { setSection(e.target.value); setLimit(100); }}>
            <option value="">Toutes les sections</option>
            {(sections.data ?? []).map((s) => <option key={s.section} value={s.section}>{s.section} ({s.producers})</option>)}
          </select>
          {(section || q || chain) && <button className="btn btn-ghost btn-small" onClick={() => { setQ(''); setSection(''); setChain(''); }}>Effacer les filtres</button>}
        </>}
        footer={!loading && rows.length >= limit ? <button className="btn btn-secondary btn-small" onClick={() => setLimit(limit + 100)}>Afficher plus de producteurs</button> : undefined}
        columns={[
          { header: 'ID', render: (p) => <code>{p.internal_code}</code> }, { header: 'Nom', render: (p) => p.last_name }, { header: 'Prénoms', render: (p) => p.first_names },
          { header: 'Sexe', render: (p) => SEX[p.gender] ?? '' }, { header: 'Village', render: (p) => p.village ?? '' }, { header: 'Section', render: (p) => p.section ?? '' },
          { header: 'Superficie (ha)', align: 'right', render: (p) => num(p.area_ha) === '—' ? '' : num(p.area_ha) }, { header: 'Parcelles', align: 'right', render: (p) => (p.parcels_count ? p.parcels_count : '') }, { header: 'Surface cartographiée (ha)', align: 'right', render: (p) => (p.parcels_count ? num(p.parcels_area_ha) : '') },
          { header: 'Téléphone', render: (p) => p.phone ?? '' },
          { header: 'Statut', render: (p) => <StatusBadge map={PRODUCER_STATUS} value={p.status} /> },
        ]}
        actions={<>
          {can('producers:create') && <button className="btn" onClick={() => setCreating(true)}>Nouveau</button>}
          {can('producers:import') && can('producers:create') && <button className="btn btn-secondary" onClick={() => setImporting(true)}>Importer (Excel)</button>}
          {can('producers:update') && <button className="btn btn-secondary" disabled={!cur} onClick={() => setEditing(true)}>Modifier</button>}
          {can('producers:status') && <button className="btn btn-secondary" disabled={!cur || cur.status === 'archived'} onClick={() => cur && setChg(cur)}>Statut</button>}
          <button className="btn btn-secondary" onClick={() => window.print()}>Imprimer</button>
        </>}>
        {loading && !rows.length ? <Loading /> : !cur ? <p className="muted">Choisissez un producteur dans la liste.</p> : (
          <>
            <Tabs tabs={tabs} value={tab} onChange={setTab} />
            {tab === 'info' && (
              <div className="fiche-with-photo"><PhotoBox type="producer" id={cur.id} name={`${cur.last_name} ${cur.first_names}`} canEdit={can('producers:update')} />
              <div className="fiche-form">
                <FicheRow label="ID"><code>{cur.internal_code}</code></FicheRow><FicheRow label="Statut"><StatusBadge map={PRODUCER_STATUS} value={cur.status} /></FicheRow>
                <FicheRow label="Nom">{cur.last_name}</FicheRow><FicheRow label="Prénoms">{cur.first_names}</FicheRow>
                <FicheRow label="Sexe">{cur.gender === 'female' ? 'Féminin' : cur.gender === 'male' ? 'Masculin' : '—'}</FicheRow><FicheRow label="Contact">{cur.phone ?? '—'}</FicheRow>
                <FicheRow label="Village">{cur.village ?? '—'}</FicheRow><FicheRow label="Section">{cur.section ?? '—'}</FicheRow>
                <FicheRow label="Superficie (ha)">{num(cur.area_ha)}</FicheRow><FicheRow label="Estimation (kg)">{num(cur.estimated_kg, 0)}</FicheRow>
                <FicheRow label="Filières">{(cur.value_chain_ids ?? []).length ? (cur.value_chain_ids as string[]).map((id) => <span key={id} className="chip">{chainName(id)}</span>) : '—'}</FicheRow>
              </div></div>
            )}
            {tab === 'id' && (
              <div className="fiche-form">
                <FicheRow label="Type de pièce">{ID_DOC[detail.data?.id_doc_type] ?? detail.data?.id_doc_type ?? '—'}</FicheRow>
                <FicheRow label="N° de la pièce">{detail.data?.id_doc_number ?? (detail.data && !can('documents:sensitive') ? 'Réservé' : '—')}</FicheRow>
                <FicheRow label="Date de naissance">{detail.data?.birth_date ? new Date(detail.data.birth_date).toLocaleDateString('fr-FR') : '—'}</FicheRow>
                <FicheRow label="Consentement">{detail.data?.consent_at ? `Reçu le ${new Date(detail.data.consent_at).toLocaleDateString('fr-FR')}` : '—'}</FicheRow>
              </div>
            )}
            {tab === 'plantations' && (plots.loading ? <Loading /> : (
              <Table rows={plots.data ?? []} empty="Aucune plantation enregistrée pour ce producteur." columns={[
                { header: 'Code', render: (x: any) => <code>{x.code}</code> }, { header: 'Superficie déclarée (ha)', align: 'right', render: (x: any) => num(x.declared_area_ha) },
                { header: 'Superficie mesurée (ha)', align: 'right', render: (x: any) => num(x.geometry_area_ha) }, { header: 'Vérification', render: (x: any) => x.verification_status ?? '—' }, { header: 'Enregistrée le', render: (x: any) => (x.registered_on ? new Date(x.registered_on).toLocaleDateString('fr-FR') : '—') },
              ]} />
            ))}
            {tab === 'suivi' && <p><button className="btn btn-secondary" onClick={() => setProf(cur)}>Voir les formations, distributions et tâches de {cur.first_names}</button></p>}
          </>
        )}
      </Registre>
      {prof && <ProducerProfile p={prof} onClose={() => setProf(null)} />}
      {chg && <ChangeStatus p={chg} onClose={() => setChg(null)} onDone={() => { setChg(null); reload(); }} />}
      {importing && <ImportProducers onClose={() => setImporting(false)} onDone={() => reload()} />}
      {creating && <NewProducer onClose={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />}
      {editing && cur && <EditProducer p={cur} detail={detail.data} onClose={() => setEditing(false)} onDone={() => { setEditing(false); reload(); }} />}
    </>
  );
}

/** Modification de la fiche d'un producteur (le code et le statut se gèrent ailleurs). */
function EditProducer({ p, detail, onClose, onDone }: { p: any; detail: any; onClose: () => void; onDone: () => void }) {
  const chains = useAsync(() => getChains().catch(() => [] as any[]), []);
  const [f, setF] = useState({
    last_name: p.last_name ?? '', first_names: p.first_names ?? '', gender: p.gender ?? '', phone: p.phone ?? '', village: p.village ?? '', section: p.section ?? '',
    area_ha: p.area_ha != null ? String(Number(p.area_ha)) : '', estimated_kg: p.estimated_kg != null ? String(Number(p.estimated_kg)) : '',
    id_doc_type: detail?.id_doc_type ?? '', id_doc_number: detail?.id_doc_number ?? '', birth_date: detail?.birth_date ? String(detail.birth_date).slice(0, 10) : '',
  });
  const [picked, setPicked] = useState<string[]>(p.value_chain_ids ?? []);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const ok = f.last_name.trim() && f.first_names.trim() && (f.phone === '' || /^\+?\d{8,15}$/.test(f.phone)) && (f.area_ha === '' || /^\d+(\.\d{1,4})?$/.test(f.area_ha));
  return (
    <Modal title={`Fiche de ${p.last_name} ${p.first_names}`} onClose={onClose}>
      <div className="grid-2"><Field label="Nom"><input value={f.last_name} onChange={set('last_name')} /></Field><Field label="Prénoms"><input value={f.first_names} onChange={set('first_names')} /></Field></div>
      <div className="grid-2"><Field label="Sexe"><select value={f.gender} onChange={set('gender')}><option value="">—</option><option value="male">Masculin</option><option value="female">Féminin</option></select></Field>
        <Field label="Contact" hint="Format international, par exemple +2250701020304"><input inputMode="tel" value={f.phone} onChange={set('phone')} /></Field></div>
      <div className="grid-2"><Field label="Village"><input value={f.village} onChange={set('village')} /></Field><Field label="Section"><input value={f.section} onChange={set('section')} /></Field></div>
      <div className="grid-2"><Field label="Superficie (ha)"><input inputMode="decimal" value={f.area_ha} onChange={set('area_ha')} /></Field><Field label="Estimation de production (kg)"><input inputMode="decimal" value={f.estimated_kg} onChange={set('estimated_kg')} /></Field></div>
      <div className="grid-2"><Field label="Type de pièce"><select value={f.id_doc_type} onChange={set('id_doc_type')}><option value="">—</option>{Object.entries(ID_DOC).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="N° de la pièce"><input value={f.id_doc_number} onChange={set('id_doc_number')} maxLength={60} /></Field></div>
      <Field label="Date de naissance"><input type="date" value={f.birth_date} onChange={set('birth_date')} /></Field>
      <Field label="Filières"><div className="role-pick">{(chains.data ?? []).map((v: any) => <label key={v.id} className="check"><input type="checkbox" checked={picked.includes(v.id)} onChange={() => setPicked((x) => (x.includes(v.id) ? x.filter((y) => y !== v.id) : [...x, v.id]))} /> {v.name}</label>)}</div></Field>
      {error && <ErrorBox message={error} />}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={busy || !ok} onClick={() => run(async () => { await put(`/producers/${p.id}`, { ...f, value_chain_ids: picked }); onDone(); })}>Enregistrer</button></div>
    </Modal>
  );
}

function NewProducer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const chains = useAsync(() => getChains(), []);
  const [f, setF] = useState({ code: '', gender: '', last_name: '', first_names: '', phone: '', village: '', section: '', area: '', est: '', chain: '' });
  const [photo, setPhoto] = useState<File | null>(null);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const codeOk = /^[A-Za-z0-9_-]{1,30}$/.test(f.code.trim());

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await post<any>('/producers', {
        internal_code: f.code.trim(), last_name: f.last_name.trim(), first_names: f.first_names.trim(), ...(f.gender && { gender: f.gender }),
        ...(f.phone.trim() && { phone: f.phone.trim() }), ...(f.village.trim() && { village: f.village.trim() }), ...(f.section.trim() && { section: f.section.trim() }), ...(/^\d+(\.\d{1,4})?$/.test(f.area.trim()) && { area_ha: f.area.trim() }), ...(/^\d+(\.\d{1,2})?$/.test(f.est.trim()) && { estimated_kg: f.est.trim() }),
        ...(f.chain && { value_chain_ids: [f.chain] }),
      });
      if (photo) { try { await uploadPhoto('producer', r.producer.id, photo); } catch (e: any) { throw new Error(`Producteur enregistré, mais la photo n'a pas été envoyée (${e?.message ?? e}). Ajoutez-la depuis sa fiche.`); } }
      onDone();
    });
  };
  return (
    <Modal title="Nouveau producteur" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="new-person"><PhotoPick file={photo} onChange={setPhoto} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Field label="Nom *"><input required value={f.last_name} onChange={set('last_name')} /></Field>
            <Field label="Prénoms *"><input required value={f.first_names} onChange={set('first_names')} /></Field>
            <Field label="Code *" hint="Lettres, chiffres, tiret ; 30 caractères au maximum."><input required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} maxLength={30} /></Field>
          </div></div>
        <p className="muted" style={{ margin: '.2rem 0 .6rem' }}>Les autres informations sont facultatives.</p>
        <Field label="Sexe"><select value={f.gender} onChange={set('gender')}><option value="">—</option><option value="male">Masculin</option><option value="female">Féminin</option></select></Field>
        <Field label="Téléphone" hint="Format international, par exemple +2250701020304"><input inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Village"><input value={f.village} onChange={set('village')} /></Field>
        <Field label="Superficie (ha)"><input inputMode="decimal" value={f.area} onChange={set('area')} /></Field>
        <Field label="Estimation de production (kg)"><input inputMode="decimal" value={f.est} onChange={set('est')} /></Field>
        <Field label="Section"><input value={f.section} onChange={set('section')} /></Field>
        <Field label="Filière">
          <select value={f.chain} onChange={set('chain')}><option value="">— Aucune —</option>{(chains.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </Field>
        {chains.data && !chains.data.length && <Empty>Aucune filière définie.</Empty>}
        {error && <ErrorBox message={error} />}
        <div className="modal-foot"><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button className="btn" disabled={busy || !codeOk}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button></div>
      </form>
    </Modal>
  );
}

function ChangeStatus({ p, onClose, onDone }: { p: any; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const hist = useAsync(() => get<any[]>(`/producers/${p.id}/status-history`).catch(() => []), [p.id]);
  const { busy, error, run } = useAction();
  return (
    <Modal title={`Statut de ${p.last_name} ${p.first_names}`} onClose={onClose}>
      <p>Statut actuel : <StatusBadge map={PRODUCER_STATUS} value={p.status} /></p>
      <Field label="Nouveau statut"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">—</option>{Object.entries(PRODUCER_STATUS).filter(([k]) => k !== p.status && k !== 'creating').map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Motif"><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {error && <ErrorBox message={error} />}
      {(hist.data ?? []).length > 0 && <><h3>Historique</h3><ul>{hist.data!.map((h: any) => <li key={h.id}>{new Date(h.created_at).toLocaleDateString('fr-FR')} : {h.from_status ?? '—'} → {h.to_status} ({h.reason})</li>)}</ul></>}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn" disabled={busy || !status || reason.trim().length < 3} onClick={() => run(async () => { await post(`/producers/${p.id}/status`, { status, reason }); onDone(); })}>Changer le statut</button></div>
    </Modal>
  );
}

const IMPORT_FIELDS: [string, string][] = [
  ['last_name', 'Nom *'], ['first_names', 'Prénoms *'], ['internal_code', 'Code'], ['gender', 'Sexe'], ['phone', 'Téléphone'], ['region', 'Région'], ['department', 'Département'],
  ['section', 'Section'], ['village', 'Village'], ['area_ha', 'Superficie (ha)'], ['estimated_kg', 'Estimation (kg)'], ['value_chains', 'Filières'], ['joined_on', "Date d'adhésion"],
];

/** Import d'une liste de producteurs depuis un classeur Excel : simulation (rapport), correspondance des colonnes si besoin, puis confirmation. */
function ImportProducers({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<any>(null);
  const [headers, setHeaders] = useState<string[] | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [finished, setFinished] = useState(false);
  const { busy, error, run } = useAction();
  const send = (confirm: boolean) => run(async () => {
    const form = new FormData(); form.append('file', file!);
    const m = Object.fromEntries(Object.entries(map).filter(([, v]) => v));
    if (Object.keys(m).length) form.append('mapping', JSON.stringify(m));
    try {
      const r = await postForm<any>(`/producers/imports${confirm ? '?confirm=true' : ''}`, form);
      setHeaders(r.headers); setReport(r);
      if (!Object.keys(map).length) setMap(r.mapping ?? {});
      if (confirm) { setFinished(true); onDone(); }
    } catch (e: any) {
      const b = e instanceof ApiError ? (e.body as any) : null;
      if (b?.missing_mapping) { setHeaders(b.headers); setReport(null); }
      throw e;
    }
  });
  const issues: { line: number; problem: string }[] = report?.issues ?? [];
  return (
    <Modal title="Importer des producteurs (Excel)" onClose={onClose}>
      <p className="muted">Fichier Excel (.xlsx), une ligne par producteur, première ligne = noms des colonnes. Seuls Nom et Prénoms sont obligatoires ; le code est attribué automatiquement s'il manque. 5 000 lignes au maximum.</p>
      <p><button type="button" className="btn btn-small btn-secondary" onClick={() => download('/producers/imports/template', 'modele-producteurs.xlsx')}>Télécharger le modèle Excel</button></p>
      <Field label="Fichier"><input type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); setHeaders(null); setMap({}); setFinished(false); }} /></Field>
      {headers && !finished && (
        <details open={!report}><summary>Correspondance des colonnes</summary>
          <div className="grid-2">{IMPORT_FIELDS.map(([k, l]) => (
            <Field key={k} label={l}><select value={map[k] ?? ''} onChange={(e) => setMap({ ...map, [k]: e.target.value })}><option value="">— Aucune —</option>{headers.map((h) => <option key={h} value={h}>{h}</option>)}</select></Field>))}
          </div></details>)}
      {error && <ErrorBox message={error} />}
      {report && (
        <div className={finished ? 'ok-box' : ''}>
          <p><strong>{finished ? 'Import terminé' : 'Simulation (rien n\'est encore enregistré)'}</strong> : {report.total} ligne(s) lue(s), {report.created} {finished ? 'créée(s)' : 'à créer'}, {report.skipped} ignorée(s).</p>
          {issues.length > 0 && <ul className="muted" style={{ maxHeight: '10rem', overflow: 'auto' }}>{issues.slice(0, 200).map((i, n) => <li key={n}>Ligne {i.line} : {i.problem}</li>)}</ul>}
        </div>)}
      <div className="modal-foot"><button className="btn btn-secondary" onClick={onClose}>{finished ? 'Fermer' : 'Annuler'}</button>
        {!finished && <button className="btn btn-secondary" disabled={busy || !file} onClick={() => send(false)}>{report ? 'Relancer la simulation' : 'Vérifier le fichier'}</button>}
        {!finished && report && report.created > 0 && <button className="btn" disabled={busy} onClick={() => send(true)}>Importer {report.created} producteur(s)</button>}</div>
    </Modal>
  );
}
