import { Link } from 'react-router-dom';
import { get } from '../api';
import { useAuth } from '../auth';
import { kg, money } from '../format';
import { Card, ErrorBox, Loading, PageHeader, Stat, useAsync } from '../ui';

const ok = async <T,>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };

export default function Dashboard() {
  const { can, me } = useAuth();
  const { data, loading, error, reload } = useAsync(async () => {
    const [producers, parcels, decls, stocks, accounts, loans, alerts] = await Promise.all([
      can('producers:read') ? ok(get<any[]>('/producers')) : null,
      can('parcels:read') ? ok(get<any[]>('/parcels')) : null,
      can('declarations:read') ? ok(get<any[]>('/purchase-declarations')) : null,
      can('warehouses:read') ? ok(get<any[]>('/stocks')) : null,
      can('finance:read') ? ok(get<any[]>('/financial-accounts')) : null,
      can('loans:read') ? ok(get<any[]>('/loans')) : null,
      can('alerts:read') ? ok(get<any>('/alerts')) : null,
    ]);
    return { producers, parcels, decls, stocks, accounts, loans, alerts };
  }, []);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? 'Chargement impossible'} onRetry={reload} />;
  const { producers, parcels, decls, stocks, accounts, loans, alerts } = data;
  const pending = decls?.filter((d) => ['received', 'in_review', 'to_correct'].includes(d.status)).length;
  const cash = accounts?.filter((a) => a.owner_type === 'cash_register').reduce((s, a) => s + Number(a.balance), 0);
  const owed = loans?.filter((l) => l.status === 'disbursed').reduce((s, l) => s + Number(l.remaining ?? 0), 0);
  const stockKg = stocks?.reduce((s, x) => s + Number(x.balance_kg), 0);
  const c = alerts?.counts ?? {};
  const alertTotal = Object.values<number>(c).reduce((s, n) => s + n, 0);

  return (
    <>
      <PageHeader title={`Bonjour ${me?.user.full_name.split(' ')[0] ?? ''}`} subtitle="Vue d'ensemble de votre coopérative" />
      <div className="grid">
        {producers && <Stat label="Producteurs" value={producers.length} />}
        {parcels && <Stat label="Parcelles" value={parcels.length} hint={`${parcels.filter((p) => p.verification_status === 'verified').length} vérifiée(s)`} />}
        {decls && <Stat label="Déclarations à traiter" value={pending} tone={pending ? 'warn' : 'ok'} />}
        {stocks && <Stat label="Stock total" value={kg(stockKg)} />}
        {accounts && <Stat label="Solde des caisses" value={money(cash)} />}
        {loans && <Stat label="Prêts à recouvrer" value={money(owed)} tone={owed ? 'warn' : 'neutral'} />}
      </div>
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
      {!producers && !decls && !accounts && <Card><p className="muted">Votre rôle ne donne accès à aucun indicateur. Contactez l'administrateur de votre coopérative.</p></Card>}
    </>
  );
}
