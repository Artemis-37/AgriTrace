import HomeScene from './HomeScene';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../api';
import { useAuth } from '../auth';
import { dateTime } from '../format';
import { Tiles } from './Tiles';
import { Card, ErrorBox, Loading, PageHeader, Stat, useAsync } from '../ui';

const ok = async <T,>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const JOURS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/** Petit calendrier du mois (lundi en premier), jour courant en évidence. */
function MiniCalendar() {
  const today = new Date();
  const [cur, setCur] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const y = cur.getFullYear(), m = cur.getMonth();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const isToday = (d: number | null) => d !== null && d === today.getDate() && m === today.getMonth() && y === today.getFullYear();
  return (
    <section className="mini-cal" aria-label="Calendrier">
      <div className="mini-cal-head">
        <button className="btn btn-ghost btn-small" aria-label="Mois précédent" onClick={() => setCur(new Date(y, m - 1, 1))}>‹</button>
        <strong>{MOIS[m]} {y}</strong>
        <button className="btn btn-ghost btn-small" aria-label="Mois suivant" onClick={() => setCur(new Date(y, m + 1, 1))}>›</button>
      </div>
      <table>
        <thead><tr>{JOURS.map((j, i) => <th key={i} scope="col">{j}</th>)}</tr></thead>
        <tbody>{Array.from({ length: cells.length / 7 }, (_, r) => (
          <tr key={r}>{cells.slice(r * 7, r * 7 + 7).map((d, i) => <td key={i} className={isToday(d) ? 'today' : ''} aria-current={isToday(d) ? 'date' : undefined}>{d ?? ''}</td>)}</tr>
        ))}</tbody>
      </table>
    </section>
  );
}

export default function Dashboard() {
  const { can, me } = useAuth();
  const { data, loading, error, reload } = useAsync(async () => {
    const [sync, alerts] = await Promise.all([ok(get<any>('/replication/status')), can('alerts:read') ? ok(get<any>('/alerts')) : null]);
    return { sync, alerts };
  }, []);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? 'Chargement impossible'} onRetry={reload} />;
  const { sync, alerts } = data;
  const exporter = can('training:propose') && !can('training:forward');
  const c = alerts?.counts ?? {};
  const alertTotal = Object.values<number>(c).reduce((s, n) => s + n, 0);

  return (
    <>
      <HomeScene />
      <PageHeader title={`Bonjour ${me?.user.full_name.split(' ')[0] ?? ''}`} subtitle="Vue d'ensemble de votre coopérative" />
      <Tiles />
      <div className="grid">
        {sync?.mode === 'local' && (
          <Stat label="Synchronisation avec le central"
            value={!sync.linked ? 'Non reliée' : sync.last_error ? 'En erreur' : sync.pending_rows ? `${sync.pending_rows} en attente` : 'À jour'}
            tone={!sync.linked ? 'neutral' : sync.last_error ? 'bad' : sync.pending_rows ? 'warn' : 'ok'}
            hint={sync.linked ? (sync.last_ok_at ? `Dernier envoi : ${dateTime(sync.last_ok_at)}` : 'Aucun envoi réussi') : undefined} />
        )}
      </div>
      <div className="home-row">
      <MiniCalendar />
      {exporter && (
        <Card title="Votre espace exportateur">
          <ol style={{ margin: 0, paddingLeft: '1.2rem' }}>
            <li>Vous proposez un module de formation à l'ADG de la coopérative.</li>
            <li>L'ADG le transmet aux coachs, sans le modifier.</li>
            <li>Les coachs dispensent la formation et saisissent leurs résultats.</li>
            <li>L'ADG vous transmet ces résultats, tels que saisis.</li>
          </ol>
          <p><Link className="btn" style={{ textDecoration: "none" }} to="/modules-exportateurs">Ouvrir mes modules de formation</Link></p>
        </Card>
      )}
      {alerts && (
        <Card title={alertTotal ? `Points d'attention (${alertTotal})` : "Points d'attention"}>
          {!alertTotal ? <p className="muted">Rien à signaler.</p> : (
            <ul className="plain">
              {c.weighings_pending_approval > 0 && <li><Link to="/stocks">{c.weighings_pending_approval} pesée(s) à valider</Link> (écart au-delà du seuil)</li>}
              {c.certificates_expired > 0 && <li><Link to="/qualite">{c.certificates_expired} certificat(s) expiré(s)</Link></li>}
              {c.certificates_expiring > 0 && <li><Link to="/qualite">{c.certificates_expiring} certificat(s) arrivent à échéance</Link></li>}
              {c.inspections_overdue > 0 && <li><Link to="/qualite">{c.inspections_overdue} inspection(s) en retard</Link></li>}
              {c.corrective_actions_overdue > 0 && <li><Link to="/qualite">{c.corrective_actions_overdue} action(s) corrective(s) en retard</Link></li>}
              {c.loan_installments_overdue > 0 && <li><Link to="/finances">{c.loan_installments_overdue} prêt(s) avec échéance impayée</Link></li>}
              {c.producers_to_inspect > 0 && <li>{c.producers_to_inspect} producteur(s) à inspecter (jamais ou depuis plus d'un an)</li>}
            </ul>
          )}
        </Card>
      )}
      </div>
    </>
  );
}
