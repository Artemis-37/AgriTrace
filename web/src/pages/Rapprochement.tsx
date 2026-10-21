import { FormEvent, useRef, useState } from 'react';
import { get, post, postForm } from '../api';
import { date, dateTime, money } from '../format';
import { Badge, Card, ErrorBox, Field, Loading, Modal, StatusBadge, Table, useAction, useAsync } from '../ui';

const ST: Record<string, [string, any]> = { matched: ['Pointée', 'good'], unmatched: ['À traiter', 'warn'], ignored: ['Ignorée', 'neutral'] };
const guess = (headers: string[]) => {
  const f = (re: RegExp) => headers.find((h) => re.test(h.toLowerCase())) ?? '';
  return { date: f(/date/), label: f(/libell|d[ée]signation|label|description|intitul/), debit: f(/d[ée]bit/), credit: f(/cr[ée]dit/), amount: f(/montant|amount/), reference: f(/r[ée]f|n°|num/) };
};

/** Rapprochement bancaire (CDC §21.1) : import d'un relevé CSV et pointage avec les opérations du compte. */
export default function Rapprochement() {
  const accounts = useAsync(() => get<any[]>('/financial-accounts'), []);
  const list = useAsync(() => get<any[]>('/bank-statements'), []);
  const [open, setOpen] = useState<string | null>(null);
  const [account, setAccount] = useState('');
  const [map, setMap] = useState({ date: '', label: '', debit: '', credit: '', amount: '', reference: '' });
  const [headers, setHeaders] = useState<string[]>([]);
  const [result, setResult] = useState<any | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const act = useAction();

  const onFile = async () => {
    const f = file.current?.files?.[0];
    setResult(null);
    if (!f) return setHeaders([]);
    const first = (await f.slice(0, 4000).text()).replace(/^﻿/, '').split(/\r?\n/)[0] ?? '';
    const d = [';', '\t', ',', '|'].map((x) => [x, first.split(x).length] as const).sort((a, b) => b[1] - a[1])[0][0];
    const h = first.split(d).map((x) => x.replace(/^"|"$/g, '').trim());
    setHeaders(h); setMap(guess(h));
  };
  const send = (dry: boolean) => (e?: FormEvent) => {
    e?.preventDefault();
    const f = file.current?.files?.[0];
    if (!f || !account) return;
    const body: any = { date: map.date, label: map.label, reference: map.reference || undefined };
    if (map.amount) body.amount = map.amount; else { body.debit = map.debit || undefined; body.credit = map.credit || undefined; }
    const form = new FormData(); form.append('file', f); form.append('account_id', account); form.append('mapping', JSON.stringify(body)); if (dry) form.append('dry_run', '1');
    act.run(async () => { const r = await postForm('/bank-statements/import', form); setResult(r); if (!dry) { if (file.current) file.current.value = ''; setHeaders([]); list.reload(); } });
  };
  const sel = (k: keyof typeof map, label: string) => <Field label={label}><select value={map[k]} onChange={(e) => setMap({ ...map, [k]: e.target.value })}><option value="">—</option>{headers.map((h) => <option key={h}>{h}</option>)}</select></Field>;

  return (
    <>
      <Card title="Importer un relevé bancaire (CSV)">
        <p className="muted">Exportez le relevé de la banque en CSV, choisissez le compte, vérifiez la correspondance des colonnes puis simulez. Les lignes dont une seule opération du compte a le même sens et le même montant (à 3 jours près) sont pointées d'office ; les autres restent à traiter. Le fichier n'est jamais modifié et ne peut pas être importé deux fois.</p>
        <form onSubmit={send(false)} className="form-grid">
          <Field label="Compte"><select value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Choisir…</option>{(accounts.data ?? []).filter((a: any) => a.owner_type === 'cash_register' || a.owner_type === 'other').map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          <Field label="Fichier CSV"><input ref={file} type="file" accept=".csv,text/csv,text/plain" onChange={onFile} /></Field>
          {headers.length > 0 && <>{sel('date', 'Colonne date')}{sel('label', 'Colonne libellé')}{sel('amount', 'Montant signé (ou…)')}{sel('debit', '…colonne débit')}{sel('credit', '…colonne crédit')}{sel('reference', 'Référence (facultatif)')}</>}
        </form>
        {act.error && <ErrorBox message={act.error} />}
        <div className="toolbar">
          <button className="btn btn-secondary" disabled={act.busy || !account || !headers.length || !map.date || !map.label} onClick={() => send(true)()}>Simuler</button>
          <button className="btn" disabled={act.busy || !account || !headers.length || !map.date || !map.label} onClick={() => send(false)()}>Importer le relevé</button>
        </div>
        {result && <p role="status">{result.dry_run ? 'Simulation : ' : 'Relevé importé : '}{result.lines} ligne(s) du {date(result.period.from)} au {date(result.period.to)} — <strong>{result.auto_matched}</strong> pointée(s) automatiquement, {result.unmatched} à traiter{result.ambiguous ? ` (dont ${result.ambiguous} ambiguë(s))` : ''}{result.skipped_errors?.length ? `, ${result.skipped_errors.length} ligne(s) illisible(s) ignorée(s)` : ''}.</p>}
      </Card>
      <Card title="Relevés importés">
        {list.loading ? <Loading /> : <Table rows={list.data ?? []} empty="Aucun relevé importé." columns={[
          { header: 'Importé le', render: (s) => dateTime(s.imported_at) }, { header: 'Compte', render: (s) => s.account_name }, { header: 'Fichier', render: (s) => s.filename },
          { header: 'Période', render: (s) => `${date(s.period_from)} → ${date(s.period_to)}` },
          { header: 'Pointage', render: (s) => <>{s.matched}/{s.line_count} pointées {s.unmatched > 0 && <Badge tone="warn">{s.unmatched} à traiter</Badge>}</> },
          { header: '', render: (s) => <button className="btn btn-ghost btn-small" onClick={() => setOpen(s.id)}>Ouvrir</button> },
        ]} />}
      </Card>
      {open && <Statement id={open} onClose={() => { setOpen(null); list.reload(); }} />}
    </>
  );
}

function Statement({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, error, reload } = useAsync(() => get<any>(`/bank-statements/${id}`), [id]);
  const [pick, setPick] = useState<any | null>(null);
  const act = useAction();
  return (
    <Modal title={data ? `Relevé ${data.filename}` : 'Relevé'} onClose={onClose}>
      {loading && <Loading />}{error && <ErrorBox message={error} />}{act.error && <ErrorBox message={act.error} />}
      {data && <>
        <p>Compte <strong>{data.account_name}</strong> · pointé {money(data.summary.matched_total)} · à traiter {money(data.summary.unmatched_total)} · ignoré {money(data.summary.ignored_total)}</p>
        <Table rows={data.lines} empty="" columns={[
          { header: 'Date', render: (l: any) => date(l.op_date) }, { header: 'Libellé', render: (l: any) => l.label }, { header: 'Montant', render: (l: any) => money(l.amount) },
          { header: 'État', render: (l: any) => <><StatusBadge map={ST} value={l.status} />{l.auto_matched ? ' auto' : ''}{l.tx_reason ? <small className="muted"> {l.tx_reason}</small> : l.note ? <small className="muted"> {l.note}</small> : null}</> },
          { header: '', render: (l: any) => (
            <span className="row-actions">
              {l.status === 'unmatched' && <button className="btn btn-ghost btn-small" disabled={act.busy} onClick={() => setPick(l)}>Pointer…</button>}
              {l.status === 'unmatched' && <button className="btn btn-ghost btn-small" disabled={act.busy} onClick={async () => { const note = prompt('Pourquoi ignorer cette ligne (frais, agios…) ?') ?? undefined; if (note !== undefined && await act.run(() => post(`/bank-statement-lines/${l.id}/ignore`, { note }))) reload(); }}>Ignorer</button>}
              {l.status !== 'unmatched' && <button className="btn btn-ghost btn-small" disabled={act.busy} onClick={async () => { if (await act.run(() => post(`/bank-statement-lines/${l.id}/unmatch`))) reload(); }}>Défaire</button>}
            </span>) },
        ]} />
        <h3>Opérations du compte sans ligne de relevé ({data.unmatched_book_transactions.length})</h3>
        <p className="muted">À expliquer : chèque non encore encaissé, opération en cours, erreur de saisie.</p>
        <Table rows={data.unmatched_book_transactions} empty="Toutes les opérations de la période sont pointées." columns={[
          { header: 'Date', render: (t: any) => dateTime(t.created_at) }, { header: 'Sens', render: (t: any) => (t.direction === 'in' ? 'Entrée' : 'Sortie') }, { header: 'Montant', render: (t: any) => money(t.amount) }, { header: 'Motif', render: (t: any) => t.reason },
        ]} />
      </>}
      {pick && <Pick line={pick} onClose={() => setPick(null)} onDone={() => { setPick(null); reload(); }} />}
    </Modal>
  );
}

function Pick({ line, onClose, onDone }: { line: any; onClose: () => void; onDone: () => void }) {
  const { data, loading } = useAsync(() => get<any[]>(`/bank-statement-lines/${line.id}/candidates`), [line.id]);
  const act = useAction();
  return (
    <Modal title="Pointer avec une opération du compte" onClose={onClose}>
      <p>{line.label} · {money(line.amount)} · {date(line.op_date)}</p>
      {loading ? <Loading /> : <Table rows={data ?? []} empty="Aucune opération de même sens et de même montant dans les 30 jours." columns={[
        { header: 'Date', render: (t: any) => dateTime(t.created_at) }, { header: 'Motif', render: (t: any) => t.reason },
        { header: '', render: (t: any) => <button className="btn btn-small" disabled={act.busy} onClick={async () => { if (await act.run(() => post(`/bank-statement-lines/${line.id}/match`, { tx_id: t.id }))) onDone(); }}>Pointer</button> },
      ]} />}
      {act.error && <ErrorBox message={act.error} />}
    </Modal>
  );
}
