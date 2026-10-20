import { useRef, useState } from 'react';
import { ApiError, download, get, post, postForm, put } from '../api';
import { useAuth } from '../auth';
import { ANOMALY_KIND, ANOMALY_STATUS, dateTime } from '../format';
import { Badge, Card, ErrorBox, Field, Loading, Modal, PageHeader, Stat, StatusBadge, Table, Tabs, useAction, useAsync } from '../ui';
import { Confirm } from './Declarations';

export default function Cartographie() {
  const { can } = useAuth();
  const all: ['anomalies' | 'import' | 'export' | 'settings', string, boolean][] = [
    ['anomalies', 'Anomalies', can('geo:anomalies')], ['import', 'Importer', can('geo:import')], ['export', 'Exporter', can('geo:export')], ['settings', 'Tolérances', can('geo:settings')],
  ];
  const tabs = all.filter((t) => t[2]);
  const [tab, setTab] = useState(tabs[0]?.[0] ?? 'anomalies');
  return (
    <>
      <PageHeader title="Cartographie" subtitle="Chevauchements, doublons, imports et exports de parcelles" />
      <Tabs value={tab} onChange={setTab} tabs={tabs.map(([k, l]) => [k, l] as [typeof tab, string])} />
      {tab === 'anomalies' && <Anomalies />}
      {tab === 'import' && <Imports />}
      {tab === 'export' && <Export />}
      {tab === 'settings' && <Settings />}
    </>
  );
}

function Anomalies() {
  const { can } = useAuth();
  const [status, setStatus] = useState('open');
  const [act, setAct] = useState<{ a: any; resolution: 'exception' | 'corrected' } | null>(null);
  const [merge, setMerge] = useState<any | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const { data, loading, error, reload } = useAsync(() => get<any[]>(`/geo/anomalies${status ? `?status=${status}` : ''}`), [status]);
  const check = useAction();
  return (
    <Card>
      <div className="toolbar">
        <select aria-label="Statut" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous</option>{Object.entries(ANOMALY_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className="btn btn-secondary" disabled={check.busy} onClick={() => check.run(async () => {
          const r = await post('/geo/checks/run'); setReport(`${r.parcels_examined} parcelle(s) examinée(s), ${r.new_anomalies} nouvelle(s) anomalie(s), ${r.open_anomalies} ouverte(s).`); reload();
        })}>{check.busy ? 'Contrôle…' : 'Lancer le contrôle périodique'}</button>
      </div>
      {report && <p className="notice">{report}</p>}
      {check.error && <ErrorBox message={check.error} />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : (
        <Table rows={data ?? []} empty="Aucune anomalie." columns={[
          { header: 'Type', render: (a) => <>{ANOMALY_KIND[a.kind] ?? a.kind} {a.blocking && <Badge tone="bad">Bloquante</Badge>}</> },
          { header: 'Parcelle A', render: (a) => <><strong>{a.parcel_a_code}</strong><br /><small className="muted">{a.producer_a_name}</small></> },
          { header: 'Parcelle B', render: (a) => <><strong>{a.parcel_b_code}</strong><br /><small className="muted">{a.producer_b_name}</small></> },
          { header: 'Surface commune', align: 'right', render: (a) => `${Math.round(Number(a.intersection_m2)).toLocaleString('fr-FR')} m² (${Number(a.pct_a).toFixed(0)} % / ${Number(a.pct_b).toFixed(0)} %)` },
          { header: 'Détectée', render: (a) => dateTime(a.detected_at) },
          { header: 'Statut', render: (a) => <StatusBadge map={ANOMALY_STATUS} value={a.status} /> },
          { header: '', render: (a) => a.status === 'open' && (
            <div className="row-actions">
              <button className="btn btn-small btn-secondary" title={a.recommended_action} onClick={() => setAct({ a, resolution: 'corrected' })}>Corrigée</button>
              {can('geo:override') && <button className="btn btn-small btn-secondary" onClick={() => setAct({ a, resolution: 'exception' })}>Exception</button>}
              {can('geo:merge') && a.kind.startsWith('duplicate') && <button className="btn btn-small" onClick={() => setMerge(a)}>Remplacer</button>}
            </div>) },
        ]} />
      )}
      {act && <Confirm title={act.resolution === 'exception' ? 'Accepter une exception' : 'Marquer comme corrigée'} reason label="Motif ou note" onClose={() => setAct(null)}
        intro={act.resolution === 'exception' ? 'Les deux parcelles resteront actives. L\'exception est tracée et ne sera pas rouverte par les contrôles.' : 'Le serveur vérifie que le chevauchement n\'existe plus.'}
        onSubmit={async (note) => { await post(`/geo/anomalies/${act.a.id}/resolve`, { resolution: act.resolution, note }); setAct(null); reload(); }} />}
      {merge && <Merge a={merge} onClose={() => setMerge(null)} onDone={() => { setMerge(null); reload(); }} />}
    </Card>
  );
}

function Merge({ a, onClose, onDone }: { a: any; onClose: () => void; onDone: () => void }) {
  const [keep, setKeep] = useState<'a' | 'b'>('a');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const { busy, error, run } = useAction();
  const body = (confirm: boolean) => ({ keep_id: keep === 'a' ? a.parcel_a_id : a.parcel_b_id, replace_id: keep === 'a' ? a.parcel_b_id : a.parcel_a_id, reason, ...(confirm && { confirm: true }) });
  return (
    <Modal title="Remplacer un doublon" onClose={onClose}>
      <p className="notice">La parcelle remplacée est archivée (jamais supprimée), son historique est conservé et son code n'est pas réattribué. Les producteurs doivent être identiques.</p>
      <Field label="Parcelle à conserver">
        <select value={keep} onChange={(e) => { setKeep(e.target.value as 'a' | 'b'); setPreview(null); }}>
          <option value="a">{a.parcel_a_code} ({a.producer_a_name})</option><option value="b">{a.parcel_b_code} ({a.producer_b_name})</option>
        </select>
      </Field>
      <Field label="Motif"><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {preview && <p className="notice">Prévisualisation : conserver <strong>{preview.keep?.code}</strong>, archiver <strong>{preview.replace?.code}</strong>.</p>}
      {error && <ErrorBox message={error} />}
      <div className="modal-foot">
        <button className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button className="btn btn-secondary" disabled={busy || reason.trim().length < 3} onClick={() => run(async () => setPreview(await post('/geo/merges', body(false))))}>Prévisualiser</button>
        <button className="btn" disabled={busy || !preview} onClick={() => run(async () => { await post('/geo/merges', body(true)); onDone(); })}>Confirmer le remplacement</button>
      </div>
    </Modal>
  );
}

const OUTCOME_FR: Record<string, string> = { create: 'À créer', update: 'À mettre à jour', unchanged: 'Inchangé', rejected: 'Rejeté', quarantined: 'Isolé' };
const IMPORT_STATUS_FR: Record<string, [string, 'ok' | 'bad' | 'info' | 'warn']> = { simulated: ['Simulé', 'info'], processing: ['En cours', 'warn'], completed: ['Terminé', 'ok'], failed: ['Échec', 'bad'] };
const MODES: Record<string, string> = { simulate: 'Simulation (rien n\'est écrit)', create_only: 'Créer seulement', create_update: 'Créer et mettre à jour', quarantine: 'Créer, isoler les lignes en anomalie' };

function Imports() {
  const file = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState('simulate');
  const [allOrNothing, setAllOrNothing] = useState(false);
  const [ignoreCode, setIgnoreCode] = useState(false);
  const [current, setCurrent] = useState<any>(null);
  const { busy, error, run } = useAction();
  const history = useAsync(() => get<any[]>('/geo/imports'), []);
  const send = (m: string) => run(async () => {
    const f = file.current?.files?.[0];
    if (!f) throw new Error('Choisir un fichier (GeoJSON, KML, KMZ, Shapefile .zip ou GeoPackage)');
    const form = new FormData();
    form.append('file', f); form.append('mode', m);
    form.append('options', JSON.stringify({ all_or_nothing: allOrNothing, ...(ignoreCode && { ignore_parcel_code: true }) }));
    setCurrent(await postForm('/geo/imports?wait=true', form)); history.reload();
  });
  const confirm = () => run(async () => { setCurrent(await post(`/geo/imports/${current.id}/confirm?wait=true`, { mode: mode === 'simulate' ? 'create_update' : mode })); history.reload(); });
  const r = current?.report;
  return (
    <>
      <Card title="Importer des parcelles">
        <div className="toolbar">
          <input ref={file} type="file" aria-label="Fichier" accept=".geojson,.json,.kml,.kmz,.zip,.gpkg" />
          <select aria-label="Mode" value={mode} onChange={(e) => setMode(e.target.value)}>{Object.entries(MODES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <label><input type="checkbox" checked={allOrNothing} onChange={(e) => setAllOrNothing(e.target.checked)} /> Tout ou rien</label>
          <label title="Pour réimporter un export d'une autre coopérative"><input type="checkbox" checked={ignoreCode} onChange={(e) => setIgnoreCode(e.target.checked)} /> Ignorer les codes de parcelle</label>
          <button className="btn" disabled={busy} onClick={() => send(mode)}>{busy ? 'Analyse…' : mode === 'simulate' ? 'Analyser' : 'Importer'}</button>
        </div>
        <p className="muted">Colonnes reconnues automatiquement : code producteur, filière, superficie déclarée, identifiant externe. Seul le système WGS84 est accepté.</p>
        {error && <ErrorBox message={error} />}
        {r && (
          <>
            <h2>{current.file_name} — {(IMPORT_STATUS_FR[current.status] ?? [current.status])[0].toLowerCase()}</h2>
            {current.error && <ErrorBox message={current.error} />}
            <div className="grid">
              <Stat label="Objets examinés" value={r.examined} /><Stat label="À créer" value={r.creatable} tone="ok" /><Stat label="À mettre à jour" value={r.updatable} tone="info" />
              <Stat label="Inchangés" value={r.unchanged} /><Stat label="Rejetés" value={r.rejected} tone={r.rejected ? 'bad' : 'neutral'} /><Stat label="Chevauchements" value={r.overlaps} tone={r.overlaps ? 'warn' : 'neutral'} />
              <Stat label="Producteurs inconnus" value={r.unknown_producers} tone={r.unknown_producers ? 'bad' : 'neutral'} /><Stat label="Géométries invalides" value={r.invalid_geometries} tone={r.invalid_geometries ? 'bad' : 'neutral'} />
            </div>
            <Table rows={((r.anomalies ?? []) as any[]).slice(0, 100).map((x: any, i: number) => ({ ...x, id: String(i) })) as any[]} empty="Aucune anomalie dans le fichier." columns={[
              { header: 'Ligne', render: (x) => x.row }, { header: 'Producteur', render: (x) => x.producer_code ?? '—' },
              { header: 'Résultat', render: (x) => <Badge tone={x.outcome === 'rejected' ? 'bad' : 'warn'}>{OUTCOME_FR[x.outcome] ?? x.outcome}</Badge> }, { header: 'Motifs', render: (x) => x.reasons.join(' ; ') },
            ]} />
            <div className="modal-foot">
              {current.status === 'completed' && r.pending_correction > 0 && <button className="btn btn-secondary" onClick={() => download(`/geo/imports/${current.id}/quarantine.geojson`, 'quarantaine.geojson')}>Télécharger la quarantaine ({r.pending_correction})</button>}
              {current.status === 'simulated' && (r.creatable + r.updatable > 0) && <button className="btn" disabled={busy} onClick={confirm}>Confirmer l'import ({r.creatable} création(s), {r.updatable} mise(s) à jour)</button>}
            </div>
          </>
        )}
      </Card>
      <Card title="Historique des imports">
        {history.loading ? <Loading /> : (
          <Table rows={history.data ?? []} empty="Aucun import." columns={[
            { header: 'Date', render: (i) => dateTime(i.created_at) }, { header: 'Fichier', render: (i) => i.file_name }, { header: 'Format', render: (i) => i.format },
            { header: 'Mode', render: (i) => MODES[i.mode] ?? i.mode }, { header: 'Objets', align: 'right', render: (i) => i.total },
            { header: 'Statut', render: (i) => <Badge tone={(IMPORT_STATUS_FR[i.status] ?? ['', 'info'])[1]}>{(IMPORT_STATUS_FR[i.status] ?? [i.status])[0]}</Badge> },
          ]} />
        )}
      </Card>
    </>
  );
}

const FORMATS: [string, string, string][] = [['geojson', 'GeoJSON', 'geojson'], ['kml', 'KML', 'kml'], ['kmz', 'KMZ', 'kmz'], ['shapefile', 'Shapefile (zip)', 'zip'], ['gpkg', 'GeoPackage', 'gpkg']];
function Export() {
  const { can } = useAuth();
  const [format, setFormat] = useState('geojson');
  const [names, setNames] = useState(false);
  const { busy, error, run } = useAction();
  const ext = FORMATS.find((f) => f[0] === format)?.[2] ?? 'geojson';
  return (
    <Card title="Exporter les parcelles">
      <div className="toolbar">
        <select aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value)}>{FORMATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {can('geo:export_names') && <label><input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> Inclure le nom des producteurs</label>}
        <button className="btn" disabled={busy} onClick={() => run(() => download(`/geo/export?format=${format}${names ? '&include_names=true' : ''}`, `parcelles.${ext}`))}>{busy ? 'Préparation…' : 'Télécharger'}</button>
      </div>
      <p className="muted">L'export contient le code de la parcelle, le code producteur, la filière, les superficies déclarée et mesurée, le statut et la date de relevé. Les données personnelles (téléphone) ne sont jamais exportées. Chaque export est tracé.</p>
      {error && <ErrorBox message={error} />}
    </Card>
  );
}

function Settings() {
  const { data, loading, error, reload } = useAsync(() => get<any>('/geo/settings'), []);
  const [f, setF] = useState<any>(null);
  const { busy, error: err, run } = useAction();
  const [saved, setSaved] = useState(false);
  const cur = f ?? data;
  if (loading) return <Loading />;
  if (error || !cur) return <ErrorBox message={error ?? 'Indisponible'} onRetry={reload} />;
  const set = (k: string) => (e: { target: { value: string } }) => { setSaved(false); setF({ ...cur, [k]: e.target.value }); };
  return (
    <Card title="Tolérances de détection">
      <Field label="Surface commune minimale (m²)"><input type="number" min="0" value={cur.overlap_min_m2} onChange={set('overlap_min_m2')} /></Field>
      <Field label="Part minimale de la plus petite parcelle (%)"><input type="number" min="0" max="100" step="0.1" value={cur.overlap_min_pct} onChange={set('overlap_min_pct')} /></Field>
      <Field label="Seuil de doublon proche (IoU, 0 à 1)"><input type="number" min="0.5" max="1" step="0.01" value={cur.near_duplicate_iou} onChange={set('near_duplicate_iou')} /></Field>
      <Field label="Politique"><select value={cur.overlap_policy} onChange={set('overlap_policy')}><option value="block">Bloquer le contrôle et la vérification</option><option value="warn">Avertir seulement</option></select></Field>
      {err && <ErrorBox message={err} />}{saved && <p className="notice">Enregistré.</p>}
      <button className="btn" disabled={busy} onClick={() => run(async () => {
        await put('/geo/settings', { overlap_min_m2: Number(cur.overlap_min_m2), overlap_min_pct: Number(cur.overlap_min_pct), near_duplicate_iou: Number(cur.near_duplicate_iou), overlap_policy: cur.overlap_policy });
        setSaved(true); reload();
      })}>Enregistrer</button>
    </Card>
  );
}

export { ApiError };
