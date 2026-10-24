import { useRef, useState } from 'react';
import { download, get, post, postForm } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Tabs, useAction, useAsync } from '../ui';

const KG = (v: any) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 3 }));
const D = (v: any) => (v ? new Date(v).toLocaleDateString('fr-FR') : '');
const CERTS = ['Cocoa Life', 'Ferrero', 'UTZ', 'Fairtrade', 'FT USA', 'Rainforest Alliance', 'COCOA PRACTICES', 'Atsource +', 'SASSANDRA'];
type Tab = 'convois' | 'fiches';
type View = { kind: 'convoy' | 'sheet'; id: string; title: string } | null;

/** Liste des producteurs d'un convoi ou d'un chargement, dans la présentation de la fiche d'accompagnement de la coopérative. */
function Producteurs({ lines, kg, bags }: { lines: any[]; kg: number; bags: number }) {
  return (
    <div className="tw"><table>
      <thead><tr><th>N°</th><th>Nom et prénoms du planteur</th><th>Genre</th><th>Section</th><th>Code planteur</th><th>Livré au magasin le</th><th className="r">Poids net livré (kg)</th><th className="r">Sacs</th><th>N° reçu</th></tr></thead>
      <tbody>{lines.map((l) => <tr key={l.n}><td>{l.n}</td><td>{l.name}</td><td>{l.gender}</td><td>{l.section}</td><td><code>{l.code}</code></td><td>{D(l.delivered_on)}</td><td className="r">{KG(l.kg)}</td><td className="r">{l.bags}</td><td>{l.receipt}</td></tr>)}</tbody>
      <tfoot><tr><th colSpan={6}>Total</th><th className="r">{KG(kg)}</th><th className="r">{bags}</th><th /></tr></tfoot>
    </table></div>
  );
}

function ConvoyDetail({ id }: { id: string }) {
  const { data, loading, error, reload } = useAsync(() => get<any>(`/convoys/${id}/fiche-accompagnement`), [id]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? 'Chargement impossible'} onRetry={reload} />;
  return <>
    <p className="muted">Connaissement <strong>{data.convoy.convoy_no}</strong> · chauffeur {data.convoy.driver_name} · camion {data.convoy.truck_no} · poids net pesé {KG(data.convoy.net_kg)} kg, réparti entre les producteurs au prorata de leurs achats.</p>
    <Producteurs lines={data.lines} kg={data.total_kg} bags={data.total_bags} />
  </>;
}

function SheetDetail({ id }: { id: string }) {
  const { data, loading, error, reload } = useAsync(() => get<any>(`/dispatch-sheets/${id}`), [id]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? 'Chargement impossible'} onRetry={reload} />;
  const lines: any[] = data.lines ?? [];
  return <>
    <dl className="kv">
      <dt>Coopérative</dt><dd>{data.coop_name}</dd><dt>Chauffeur</dt><dd>{data.driver_name}</dd><dt>Camion / remorque</dt><dd>{data.truck_no} {data.trailer_no ? `/ ${data.trailer_no}` : ''}</dd>
      <dt>N° de connaissement</dt><dd>{data.bl_no}</dd><dt>LOT ID DSE</dt><dd>{data.lot_id_dse}</dd><dt>Date de départ</dt><dd>{D(data.departure_date)}</dd>
      <dt>Type de cacao</dt><dd>{data.cocoa_type === 'certifie' ? `Certifié (${[...(data.certifications ?? []), data.other_certification].filter(Boolean).join(', ') || '—'})` : 'Ordinaire'}</dd>
      {data.exporter_name && <><dt>Transmise à</dt><dd>{data.exporter_name} le {D(data.transmitted_at)}</dd></>}
    </dl>
    <Producteurs lines={lines} kg={lines.reduce((a, l) => a + Number(l.kg), 0)} bags={lines.reduce((a, l) => a + Number(l.bags), 0)} />
  </>;
}

function NewSheet({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const { busy, error, run } = useAction();
  const [f, setF] = useState<any>({ cocoa_type: 'ordinaire', certifications: [] as string[] });
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const txt = (k: string, label: string, hint?: string) => <Field label={label} hint={hint}><input value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} /></Field>;
  return (
    <Modal title="Nouvelle fiche d'accompagnement" onClose={onClose}>
      <p className="muted">Chargement de {ids.length} convoi(s) : les producteurs, leurs poids et leurs sacs sont repris automatiquement. Les champs ci-dessous sont facultatifs.</p>
      <div className="grid-2">{txt('driver_name', 'Nom du chauffeur', 'Par défaut : celui du premier convoi')}{txt('truck_no', 'N° du camion')}{txt('trailer_no', 'N° de remorque')}{txt('lot_id_dse', 'LOT ID DSE (Ex OT)')}{txt('bl_no', 'N° de connaissement CCC', 'Par défaut : celui du convoi si un seul')}
        <Field label="Date de départ"><input type="date" value={f.departure_date ?? ''} onChange={(e) => set('departure_date', e.target.value)} /></Field></div>
      <Field label="Type de cacao"><span className="seg" role="radiogroup" aria-label="Type de cacao">{([['ordinaire', 'Ordinaire'], ['certifie', 'Certifié']] as const).map(([k, l]) => <button key={k} className={f.cocoa_type === k ? 'on' : ''} onClick={() => set('cocoa_type', k)}>{l}</button>)}</span></Field>
      {f.cocoa_type === 'certifie' && <Field label="Certifications cochées"><div className="chips">{CERTS.map((c) => <label key={c} className="chip"><input type="checkbox" checked={f.certifications.includes(c)} onChange={(e) => set('certifications', e.target.checked ? [...f.certifications, c] : f.certifications.filter((x: string) => x !== c))} /> {c}</label>)}</div></Field>}
      {f.cocoa_type === 'certifie' && txt('other_certification', 'Autres à préciser')}
      <div className="grid-2">{txt('adg_name', "Nom & visa de l'ADG")}{txt('warehouse_keeper_name', 'Nom & visa du magasinier')}</div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => run(async () => { const body: any = { convoy_ids: ids }; for (const [k, v] of Object.entries(f)) if (v !== '' && v !== undefined) body[k] = v; await post('/dispatch-sheets', body); onDone(); })}>Créer la fiche</button></div>
    </Modal>
  );
}

function Transmit({ sheet, onClose, onDone }: { sheet: any; onClose: () => void; onDone: () => void }) {
  const ex = useAsync(() => get<any[]>('/dispatch-sheets/exporters'), []);
  const dest = useAsync(() => get<any[]>('/org-links/destinations'), []);
  const { busy, error, run } = useAction();
  const [ficheF, setFicheF] = useState<File | null>(null); const [cccF, setCccF] = useState<File | null>(null);
  const [to, setTo] = useState('');   // "u:<id>" compte exportateur interne, "o:<id>" organisation liée
  const none = !(ex.data ?? []).length && !(dest.data ?? []).length;
  return (
    <Modal title={`Transmettre la fiche ${sheet.number}`} onClose={onClose}>
      <p className="muted">Une fois transmise, la fiche ne peut plus être modifiée. Vers une organisation liée, elle devient une livraison attendue (pont bascule, analyse, bulletin de pesée) et vous en suivez l'avancement dans Livraisons.</p>
      {ex.loading || dest.loading ? <Loading /> : none ? <p className="empty">Aucun destinataire. Faites accepter un lien dans « Organisations liées », ou créez un compte exportateur dans Équipe.</p> :
        <Field label="Destinataire"><select value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choisir…</option>
          {(dest.data ?? []).length > 0 && <optgroup label="Organisations liées">{(dest.data ?? []).map((o) => <option key={o.id} value={`o:${o.id}`}>{o.name} ({o.kind === 'exporter' ? 'exportateur' : 'coopérative'})</option>)}</optgroup>}
          {(ex.data ?? []).length > 0 && <optgroup label="Comptes exportateur de la coopérative">{(ex.data ?? []).map((u) => <option key={u.id} value={`u:${u.id}`}>{u.full_name} ({u.email})</option>)}</optgroup>}
        </select></Field>}
      <Field label="Fiche d'accompagnement à joindre (Excel ou PDF, facultatif)"><input type="file" accept=".xlsx,.pdf" onChange={(e) => setFicheF(e.target.files?.[0] ?? null)} /></Field>
      <Field label="Connaissement CCC à joindre (PDF, facultatif)"><input type="file" accept=".pdf" onChange={(e) => setCccF(e.target.files?.[0] ?? null)} /></Field>
      <p className="muted">Les pièces jointes sont envoyées avec le chargement à son destinataire.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn btn-primary" disabled={busy || !to} onClick={() => run(async () => {
          for (const [kind, f] of [['fiche', ficheF], ['connaissement_ccc', cccF]] as const) if (f) { const fd = new FormData(); fd.append('file', f); await postForm(`/dispatch-sheets/${sheet.id}/attachments/${kind}`, fd); }
          await post(`/dispatch-sheets/${sheet.id}/transmit`, to.startsWith('o:') ? { destination_org_id: to.slice(2) } : { exporter_user_id: to.slice(2) }); onDone(); })}>Transmettre</button></div>
    </Modal>
  );
}

/** Fiches d'accompagnement : producteurs d'un convoi ou d'un chargement expédié à l'exportateur (consultation, export Excel, import, transmission). */
export default function FichesAccompagnement() {
  const { can } = useAuth();
  const manage = can('dispatch:manage');
  const [tab, setTab] = useState<Tab>(manage ? 'convois' : 'fiches');
  const convoys = useAsync(() => (manage ? get<any[]>('/dispatch-sheets/convoys') : Promise.resolve([] as any[])), [manage]);
  const sheets = useAsync(() => get<any[]>('/dispatch-sheets'), []);
  const [sel, setSel] = useState<string[]>([]);
  const [view, setView] = useState<View>(null);
  const [creating, setCreating] = useState(false);
  const [tx, setTx] = useState<any>(null);
  const [warn, setWarn] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const imp = useAction();
  const reloadAll = () => { convoys.reload(); sheets.reload(); setSel([]); };
  const dl = (path: string, name: string) => download(path, name).catch((e) => setMsg((e as Error).message));
  const importFile = (f: File | undefined) => {
    if (!f) return;
    imp.run(async () => { const fd = new FormData(); fd.append('file', f); const r = await postForm<any>('/dispatch-sheets/import', fd); setWarn(r.warnings ?? []); setMsg(`Fiche ${r.sheet.number} importée : ${r.sheet.lines.length} producteur(s).`); setTab('fiches'); reloadAll(); });
    if (file.current) file.current.value = '';
  };
  const tabs: [Tab, string][] = manage ? [['convois', 'Convois pesés'], ['fiches', "Fiches d'accompagnement"]] : [['fiches', "Fiches reçues"]];
  return (
    <>
      <PageHeader title="Fiches d'accompagnement" subtitle={manage ? "Consultez la liste des producteurs d'un convoi ou d'un chargement, exportez-la sur le modèle Excel de la coopérative, ou importez une fiche, puis transmettez-la à l'exportateur." : "Fiches d'accompagnement que la coopérative vous a transmises."}
        actions={manage ? <><input ref={file} type="file" accept=".xlsx" hidden onChange={(e) => importFile(e.target.files?.[0])} /><button className="btn btn-secondary" disabled={imp.busy} onClick={() => file.current?.click()}>Importer une fiche (Excel)</button></> : undefined} />
      {msg && <p className="notice" role="status">{msg}</p>}
      {imp.error && <p className="error" role="alert">{imp.error}</p>}
      {warn && warn.length > 0 && <div className="notice" role="status"><strong>À vérifier dans la fiche importée :</strong><ul>{warn.map((w) => <li key={w}>{w}</li>)}</ul></div>}
      <Tabs tabs={tabs} value={tab} onChange={(t) => { setTab(t); setView(null); }} />
      {tab === 'convois' && manage && (
        <Card title="Convois réceptionnés au magasin">
          {convoys.loading ? <Loading /> : convoys.error ? <ErrorBox message={convoys.error} onRetry={convoys.reload} /> : !(convoys.data ?? []).length ? <Empty>Aucun convoi pesé pour le moment.</Empty> : (
            <div className="tw"><table>
              <thead><tr><th /><th>Connaissement</th><th>Délégué</th><th>Camion</th><th>Reçu le</th><th className="r">Poids net (kg)</th><th className="r">Producteurs</th><th>Fiche</th><th>Actions</th></tr></thead>
              <tbody>{(convoys.data ?? []).map((v) => (
                <tr key={v.id}>
                  <td><input type="checkbox" aria-label={`Choisir ${v.convoy_no}`} disabled={!v.producers} checked={sel.includes(v.id)} onChange={(e) => setSel(e.target.checked ? [...sel, v.id] : sel.filter((x) => x !== v.id))} /></td>
                  <td><code>{v.convoy_no}</code></td><td>{v.collector_name}</td><td>{v.truck_no}</td><td>{D(v.received_at)}</td><td className="r">{KG(v.net_kg)}</td><td className="r">{v.producers}</td><td>{v.sheets ?? '—'}</td>
                  <td className="actions">
                    <button className="btn btn-ghost btn-small" disabled={!v.producers} onClick={() => setView({ kind: 'convoy', id: v.id, title: `Producteurs du convoi ${v.convoy_no}` })}>Consulter</button>
                    <button className="btn btn-ghost btn-small" disabled={!v.producers} onClick={() => dl(`/convoys/${v.id}/fiche-accompagnement.xlsx`, `Fiche_accompagnement_${v.convoy_no}.xlsx`)}>Exporter (Excel)</button>
                  </td>
                </tr>))}</tbody>
            </table></div>
          )}
          <div className="form-actions"><button className="btn btn-primary" disabled={!sel.length} onClick={() => setCreating(true)}>Créer la fiche d'un chargement ({sel.length} convoi{sel.length > 1 ? 's' : ''})</button></div>
        </Card>
      )}
      {tab === 'fiches' && (
        <Card title={manage ? "Fiches d'accompagnement" : 'Fiches reçues'}>
          {sheets.loading ? <Loading /> : sheets.error ? <ErrorBox message={sheets.error} onRetry={sheets.reload} /> : !(sheets.data ?? []).length ? <Empty>{manage ? "Aucune fiche. Créez-en une à partir des convois pesés, ou importez-en une." : "Aucune fiche ne vous a encore été transmise."}</Empty> : (
            <div className="tw"><table>
              <thead><tr><th>N°</th><th>Origine</th><th>Connaissement</th><th>Camion</th><th>Départ</th><th className="r">Poids (kg)</th><th className="r">Sacs</th><th className="r">Producteurs</th><th>État</th><th>Actions</th></tr></thead>
              <tbody>{(sheets.data ?? []).map((s) => (
                <tr key={s.id}>
                  <td><code>{s.number}</code></td><td>{s.source === 'imported' ? 'Importée' : `Convois (${s.convoys})`}</td><td>{s.bl_no}</td><td>{s.truck_no}</td><td>{D(s.departure_date)}</td><td className="r">{KG(s.declared_kg)}</td><td className="r">{s.declared_bags}</td><td className="r">{s.producers}</td>
                  <td>{s.returned_at ? <Badge tone="bad">Refoulée — volume revenu au stock</Badge> : s.status === 'transmitted' ? <Badge tone="ok">Transmise à {s.exporter_name}</Badge> : <Badge tone="warn">Brouillon</Badge>}</td>
                  <td className="actions">
                    <button className="btn btn-ghost btn-small" onClick={() => setView({ kind: 'sheet', id: s.id, title: `Producteurs de la fiche ${s.number}` })}>Consulter</button>
                    <button className="btn btn-ghost btn-small" onClick={() => dl(`/dispatch-sheets/${s.id}/export`, `Fiche_accompagnement_${s.number}.xlsx`)}>{manage ? 'Exporter (Excel)' : 'Télécharger (Excel)'}</button>
                    {manage && s.status !== 'transmitted' && <button className="btn btn-primary btn-small" onClick={() => setTx(s)}>Transmettre à l'exportateur</button>}
                  </td>
                </tr>))}</tbody>
            </table></div>
          )}
        </Card>
      )}
      {view && <Card title={view.title}>{view.kind === 'convoy' ? <ConvoyDetail id={view.id} /> : <SheetDetail id={view.id} />}<div className="form-actions"><button className="btn btn-ghost" onClick={() => setView(null)}>Fermer</button></div></Card>}
      {creating && <NewSheet ids={sel} onClose={() => setCreating(false)} onDone={() => { setCreating(false); setTab('fiches'); setMsg('Fiche créée.'); reloadAll(); }} />}
      {tx && <Transmit sheet={tx} onClose={() => setTx(null)} onDone={() => { setTx(null); setMsg("Fiche transmise à l'exportateur."); reloadAll(); }} />}
    </>
  );
}
