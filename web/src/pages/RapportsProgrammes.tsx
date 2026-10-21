import { FormEvent, useState } from 'react';
import { del, download, get, post } from '../api';
import { useAuth } from '../auth';
import { dateTime, date } from '../format';
import { Badge, Card, ErrorBox, Field, Loading, Table, useAction, useAsync } from '../ui';

const REPORT: Record<string, string> = { purchases: 'Achats', finance: 'Finances', stock: 'Stocks', quality: 'Qualité' };
const FREQ: Record<string, string> = { daily: 'Chaque jour (veille)', weekly: 'Chaque semaine (7 derniers jours)', monthly: 'Chaque mois (mois précédent)' };
const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

/** Rapports générés automatiquement (CDC §26) : liste reçue par chacun et programmation par un responsable. */
export default function RapportsProgrammes() {
  const { can } = useAuth();
  const schedule = can('reports:schedule');
  const runs = useAsync(() => get<any[]>('/report-runs'), []);
  const sch = useAsync(() => (schedule ? get<any>('/report-schedules') : Promise.resolve(null)), []);
  const users = useAsync(() => (schedule && can('users:read') ? get<any[]>('/users') : Promise.resolve([])), []);
  const [f, setF] = useState<any>({ report: 'finance', frequency: 'weekly', weekday: 1, month_day: 1, hour: 6, recipients: [], send_email: false });
  const act = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    act.run(async () => { await post('/report-schedules', { report: f.report, frequency: f.frequency, weekday: f.frequency === 'weekly' ? Number(f.weekday) : undefined, month_day: f.frequency === 'monthly' ? Number(f.month_day) : undefined, hour: Number(f.hour), recipients: f.recipients, send_email: f.send_email }); sch.reload(); });
  };
  return (
    <>
      <Card title="Rapports reçus">
        {runs.error && <ErrorBox message={runs.error} onRetry={runs.reload} />}
        {runs.loading ? <Loading /> : <Table rows={runs.data ?? []} empty="Aucun rapport automatique reçu pour le moment." columns={[
          { header: 'Généré le', render: (r) => dateTime(r.created_at) }, { header: 'Rapport', render: (r) => <Badge>{REPORT[r.report] ?? r.report}</Badge> },
          { header: 'Période', render: (r) => `${date(r.period_from)} → ${date(r.period_to)}` },
          { header: '', render: (r) => <button className="btn btn-ghost btn-small" onClick={() => download(`/report-runs/${r.id}/download`, r.filename).catch(() => undefined)}>Télécharger (Excel)</button> },
        ]} />}
      </Card>
      {schedule && (
        <Card title="Programmer l'envoi automatique">
          {!sch.data?.email_configured && <p className="muted">L'envoi par e-mail n'est pas configuré sur ce serveur : les destinataires reçoivent une notification et téléchargent le fichier ici. (Pour activer l'e-mail : variable <code>SMTP_URL</code>.)</p>}
          <form onSubmit={submit} className="form-grid">
            <Field label="Rapport"><select value={f.report} onChange={(e) => setF({ ...f, report: e.target.value })}>{Object.entries(REPORT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Fréquence"><select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}>{Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            {f.frequency === 'weekly' && <Field label="Jour"><select value={f.weekday} onChange={(e) => setF({ ...f, weekday: e.target.value })}>{DAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select></Field>}
            {f.frequency === 'monthly' && <Field label="Jour du mois (1 à 28)"><input type="number" min={1} max={28} value={f.month_day} onChange={(e) => setF({ ...f, month_day: e.target.value })} /></Field>}
            <Field label="Heure (UTC, soit l'heure d'Abidjan)"><input type="number" min={0} max={23} value={f.hour} onChange={(e) => setF({ ...f, hour: e.target.value })} /></Field>
            <Field label="Destinataires" hint="Membres autorisés à lire ce rapport (Ctrl/Cmd pour en choisir plusieurs)">
              <select multiple size={5} value={f.recipients} onChange={(e) => setF({ ...f, recipients: Array.from(e.target.selectedOptions).map((o) => o.value) })}>
                {(users.data ?? []).filter((u: any) => u.membership_status === 'active').map((u: any) => <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>)}
              </select>
            </Field>
            <label><input type="checkbox" checked={f.send_email} onChange={(e) => setF({ ...f, send_email: e.target.checked })} /> Envoyer aussi par e-mail</label>
            <div><button className="btn" disabled={act.busy || !f.recipients.length}>Programmer</button></div>
          </form>
          {act.error && <ErrorBox message={act.error} />}
          <h3>Programmations</h3>
          <Table rows={sch.data?.schedules ?? []} empty="Aucune programmation." columns={[
            { header: 'Rapport', render: (s: any) => REPORT[s.report] }, { header: 'Fréquence', render: (s: any) => `${FREQ[s.frequency]}${s.frequency === 'weekly' ? ` · ${DAYS[s.weekday - 1]}` : s.frequency === 'monthly' ? ` · le ${s.month_day}` : ''} · ${s.hour} h` },
            { header: 'Destinataires', render: (s: any) => (s.recipient_names ?? []).join(', ') + (s.send_email ? ' (e-mail)' : '') }, { header: 'Dernier envoi', render: (s: any) => (s.last_run_on ? date(s.last_run_on) : '—') },
            { header: '', render: (s: any) => <span className="row-actions">
              <button className="btn btn-ghost btn-small" disabled={act.busy} onClick={async () => { if (await act.run(() => post(`/report-schedules/${s.id}/run`))) { runs.reload(); sch.reload(); } }}>Générer maintenant</button>
              <button className="btn btn-ghost btn-small" disabled={act.busy} onClick={async () => { if (confirm('Supprimer cette programmation ?') && (await act.run(() => del(`/report-schedules/${s.id}`)))) sch.reload(); }}>Supprimer</button></span> },
          ]} />
        </Card>
      )}
    </>
  );
}
