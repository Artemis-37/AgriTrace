import { Link } from 'react-router-dom';
import { get } from '../api';
import { useAuth } from '../auth';
import { dateTime, kg, money } from '../format';
import { Tiles } from './Tiles';
import { Card, ErrorBox, Loading, PageHeader, Stat, useAsync } from '../ui';

const ok = async <T,>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };

export default function Dashboard() {
  const { can, me } = useAuth();
  const { data, loading, error, reload } = useAsync(async () => {
    const trainingOn = can('training:propose') || can('training:forward');
    const [sync, producers, parcels, decls, stocks, accounts, loans, alerts, invoices, orders, tasks, anomalies, prefin, subs, results] = await Promise.all([
      ok(get<any>('/replication/status')),
      can('producers:read') ? ok(get<any[]>('/producers')) : null,
      can('parcels:read') ? ok(get<any[]>('/parcels')) : null,
      can('declarations:read') ? ok(get<any[]>('/purchase-declarations')) : null,
      can('warehouses:read') ? ok(get<any[]>('/stocks')) : null,
      can('finance:read') ? ok(get<any[]>('/financial-accounts')) : null,
      can('loans:read') ? ok(get<any[]>('/loans')) : null,
      can('alerts:read') ? ok(get<any>('/alerts')) : null,
      can('invoices:read') ? ok(get<any[]>('/invoices')) : null,
      can('buyers:read') ? ok(get<any[]>('/sales-orders')) : null,
      can('tasks:read') ? ok(get<any>(`/tasks/dashboard${can('tasks:read_all') ? '?scope=all' : ''}`)) : null,
      can('geo:anomalies') ? ok(get<any[]>('/geo/anomalies?status=open')) : null,
      can('prefinancing:read') ? ok(get<any>('/prefinancings/report')) : null,
      trainingOn ? ok(get<any[]>('/training-submissions')) : null,
      trainingOn ? ok(get<any[]>('/training-results')) : null,
    ]);
    return { sync, producers, parcels, decls, stocks, accounts, loans, alerts, invoices, orders, tasks, anomalies, prefin, subs, results };
  }, []);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? 'Chargement impossible'} onRetry={reload} />;
  const { sync, producers, parcels, decls, stocks, accounts, loans, alerts, invoices, orders, tasks, anomalies, prefin, subs, results } = data;
  const exporter = can('training:propose') && !can('training:forward');
  const adgForward = can('training:forward');
  const subCount = (st: string) => (subs ?? []).filter((x) => x.status === st).length;
  const live = invoices?.filter((i) => i.status !== 'cancelled');
  const receivable = live?.reduce((s, i) => s + Number(i.balance), 0);
  const overdue = live?.reduce((s, i) => s + (i.overdue ? Number(i.balance) : 0), 0);
  const openOrders = orders?.filter((o) => ['confirmed', 'partially_shipped', 'shipped'].includes(o.status)).length;
  const t = tasks?.counts;
  const blocking = anomalies?.filter((a) => a.blocking).length;
  const outstanding = prefin?.by_currency?.reduce((s: number, r: any) => s + Number(r.outstanding), 0);
  const pending = decls?.filter((d) => ['received', 'in_review', 'to_correct'].includes(d.status)).length;
  const cash = accounts?.filter((a) => a.owner_type === 'cash_register').reduce((s, a) => s + Number(a.balance), 0);
  const owed = loans?.filter((l) => l.status === 'disbursed').reduce((s, l) => s + Number(l.remaining ?? 0), 0);
  const stockKg = stocks?.reduce((s, x) => s + Number(x.balance_kg), 0);
  const c = alerts?.counts ?? {};
  const alertTotal = Object.values<number>(c).reduce((s, n) => s + n, 0);

  return (
    <>
      <PageHeader title={`Bonjour ${me?.user.full_name.split(' ')[0] ?? ''}`} subtitle="Vue d'ensemble de votre coopérative" />
      <Tiles />
      <div className="grid">
        {sync?.mode === 'local' && (
          <Stat label="Synchronisation avec le central"
            value={!sync.linked ? 'Non reliée' : sync.last_error ? 'En erreur' : sync.pending_rows ? `${sync.pending_rows} en attente` : 'À jour'}
            tone={!sync.linked ? 'neutral' : sync.last_error ? 'bad' : sync.pending_rows ? 'warn' : 'ok'}
            hint={sync.linked ? (sync.last_ok_at ? `Dernier envoi : ${dateTime(sync.last_ok_at)}` : 'Aucun envoi réussi') : undefined} />
        )}
        {producers && <Stat label="Producteurs" value={producers.length} />}
        {parcels && <Stat label="Parcelles" value={parcels.length} hint={`${parcels.filter((p) => p.verification_status === 'verified').length} vérifiée(s)`} />}
        {decls && <Stat label="Déclarations à traiter" value={pending} tone={pending ? 'warn' : 'ok'} />}
        {stocks && <Stat label="Stock total" value={kg(stockKg)} />}
        {accounts && <Stat label="Solde des caisses" value={money(cash)} />}
        {orders && <Stat label="Commandes en cours" value={openOrders} />}
        {invoices && <Stat label="Créances clients" value={money(receivable)} tone={receivable ? 'info' : 'neutral'} />}
        {invoices && <Stat label="Créances échues" value={money(overdue)} tone={overdue ? 'bad' : 'ok'} />}
        {t && <Stat label="Missions en retard" value={t.overdue} tone={t.overdue ? 'warn' : 'ok'} hint={`${t.to_review} à vérifier`} />}
        {anomalies && <Stat label="Anomalies de cartographie" value={anomalies.length} tone={anomalies.length ? 'warn' : 'ok'} hint={blocking ? `${blocking} bloquante(s)` : undefined} />}
        {subs && adgForward && <Stat label="Modules d'exportateurs à transmettre" value={subCount('submitted')} tone={subCount('submitted') ? 'warn' : 'ok'} hint="Aux coachs, en un clic" />}
        {results && adgForward && <Stat label="Résultats de formation à transmettre" value={results.filter((r) => r.status === 'submitted').length} tone={results.some((r) => r.status === 'submitted') ? 'warn' : 'ok'} hint="Aux exportateurs, en un clic" />}
        {subs && exporter && <Stat label="Propositions en attente de l'ADG" value={subCount('submitted')} tone={subCount('submitted') ? 'warn' : 'neutral'} />}
        {subs && exporter && <Stat label="Transmises aux coachs" value={subCount('forwarded')} tone={subCount('forwarded') ? 'ok' : 'neutral'} />}
        {subs && exporter && <Stat label="Non retenues" value={subCount('declined')} />}
        {results && exporter && <Stat label="Résultats reçus" value={results.length} tone={results.length ? 'info' : 'neutral'} hint={results.length ? `${results.reduce((a, r) => a + Number(r.participants), 0)} participant(s) au total` : undefined} />}
        {prefin && <Stat label="Préfinancement à rembourser" value={money(outstanding)} tone={outstanding ? 'warn' : 'neutral'} />}
        {loans && <Stat label="Prêts à recouvrer" value={money(owed)} tone={owed ? 'warn' : 'neutral'} />}
      </div>
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
      {!producers && !decls && !accounts && !invoices && !orders && !tasks && !subs && <Card><p className="muted">Votre rôle ne donne accès à aucun indicateur. Contactez l'administrateur de votre coopérative.</p></Card>}
    </>
  );
}
