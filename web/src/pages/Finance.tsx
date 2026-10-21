import { useState } from 'react';
import { useDeepLink } from '../notifTarget';
import { get, post } from '../api';
import { useAuth } from '../auth';
import { LOAN_KIND, LOAN_STATUS, PAYMENT_STATUS, date, dateTime, money } from '../format';
import { Card, ErrorBox, Loading, PageHeader, StatusBadge, Table, useAsync } from '../ui';
import { Confirm } from './Declarations';
import Rapprochement from './Rapprochement';

type Tab = 'accounts' | 'payments' | 'loans' | 'accounting' | 'bank';

export default function Finance() {
  const { can } = useAuth();
  const tabs: [Tab, string, boolean][] = [
    ['accounts', 'Comptes et caisses', true], ['payments', 'Paiements', can('payments:read')], ['loans', 'Prêts et préfinancements', can('loans:read')], ['accounting', 'Comptabilité', can('accounting:read')], ['bank', 'Rapprochement bancaire', can('reconciliation:manage')],
  ];
  const dl = useDeepLink(tabs.filter((t) => t[2]).map((t) => t[0]));
  const [tab, setTab] = useState<Tab>((dl.tab as Tab) ?? 'accounts');
  return (
    <>
      <PageHeader title="Finances" subtitle="Opérations traçables, justifiées, non modifiables : une erreur se corrige par une écriture inverse" />
      <div className="tabs" role="tablist">
        {tabs.filter((t) => t[2]).map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {tab === 'accounts' && <Accounts />}
      {tab === 'payments' && <Payments />}
      {tab === 'loans' && <Loans />}
      {tab === 'accounting' && <Accounting />}
      {tab === 'bank' && <Rapprochement />}
    </>
  );
}

function Accounts() {
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/financial-accounts'), []);
  const OWNER: Record<string, string> = { cash_register: 'Caisse', producer: 'Producteur', collector: 'Collecteur', other: 'Autre' };
  return (
    <Card>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : <Table rows={data ?? []} empty="Aucun compte." columns={[
        { header: 'Compte', render: (a) => <strong>{a.name}</strong> },
        { header: 'Type', render: (a) => OWNER[a.owner_type] ?? a.owner_type },
        { header: 'Solde', align: 'right', render: (a) => <strong>{money(a.balance, a.currency)}</strong> },
      ]} />}
    </Card>
  );
}

function Payments() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/payments'), []);
  const [confirm, setConfirm] = useState<any | null>(null);
  return (
    <Card>
      <p className="notice">Aucun connecteur bancaire ou Mobile Money n'est configuré : une confirmation est toujours <strong>manuelle</strong> et ne vaut pas confirmation de la banque ou de l'opérateur.</p>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : <Table rows={data ?? []} empty="Aucun paiement." columns={[
        { header: 'Créé le', render: (p) => dateTime(p.created_at) },
        { header: 'Bénéficiaire', render: (p) => p.payee_label ?? p.payee_type },
        { header: 'Mode', render: (p) => ({ cash: 'Espèces', bank_transfer: 'Virement', mobile_money: 'Mobile Money', cheque: 'Chèque' } as Record<string, string>)[p.method] ?? p.method },
        { header: 'Montant', align: 'right', render: (p) => money(p.amount, p.currency) },
        { header: 'Statut', render: (p) => <StatusBadge map={PAYMENT_STATUS} value={p.status} /> },
        { header: '', render: (p) => (
          <div className="row-actions">
            {p.status === 'planned' && can('payments:manage') && <button className="btn btn-small btn-secondary" onClick={async () => { await post(`/payments/${p.id}/transition`, { to: 'initiated' }); reload(); }}>Marquer initié</button>}
            {['initiated', 'pending'].includes(p.status) && can('payments:confirm') && <button className="btn btn-small" onClick={() => setConfirm(p)}>Confirmer (manuel)</button>}
          </div>
        ) },
      ]} />}
      {confirm && <Confirm title="Confirmation manuelle du paiement" reason label="Justification (ex. reçu signé, référence du virement)"
        intro={`Vous attestez avoir constaté ce paiement de ${money(confirm.amount, confirm.currency)}. Le compte source sera débité.`}
        onClose={() => setConfirm(null)}
        onSubmit={async (note) => { await post(`/payments/${confirm.id}/confirm`, { confirmation_source: 'manual', note }); setConfirm(null); reload(); }} />}
    </Card>
  );
}

function Loans() {
  const { data, loading, error, reload } = useAsync(() => get<any[]>('/loans'), []);
  return (
    <Card>
      <p className="notice">Intérêts et pénalités : non calculés (à définir dans une spécification complémentaire).</p>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <Loading /> : <Table rows={data ?? []} empty="Aucun dossier." columns={[
        { header: 'Demandé le', render: (l) => date(l.requested_at) },
        { header: 'Nature', render: (l) => LOAN_KIND[l.kind] ?? l.kind },
        { header: 'Demandé', align: 'right', render: (l) => money(l.requested_amount, l.currency) },
        { header: 'Approuvé', align: 'right', render: (l) => money(l.approved_amount, l.currency) },
        { header: 'Reste dû', align: 'right', render: (l) => (l.remaining === null ? '—' : money(l.remaining, l.currency)) },
        { header: 'Statut', render: (l) => <StatusBadge map={LOAN_STATUS} value={l.status} /> },
      ]} />}
    </Card>
  );
}

function Accounting() {
  const { data, loading, error, reload } = useAsync(async () => {
    const [tb, consistency] = await Promise.all([get<any>('/accounting/trial-balance'), get<any>('/accounting/consistency')]);
    return { tb, consistency };
  }, []);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? 'Chargement impossible'} onRetry={reload} />;
  const { tb, consistency } = data;
  return (
    <>
      <p className="notice">Référentiel SYSCOHADA révisé — plan comptable de base à faire valider par un comptable compétent.</p>
      {!consistency.consistent && (
        <Card title="Contrôle de cohérence finance ↔ comptabilité">
          <p className="muted">{consistency.notice}</p>
          <Table rows={consistency.rows as any[]} columns={[
            { header: 'Compte', render: (r) => r.accounting_code },
            { header: 'Solde financier', align: 'right', render: (r) => money(r.financial_balance) },
            { header: 'Solde comptable', align: 'right', render: (r) => money(r.accounting_balance) },
            { header: 'Écart', align: 'right', render: (r) => <strong>{money(r.difference)}</strong> },
          ]} />
        </Card>
      )}
      <Card title="Balance">
        <Table rows={tb.rows as any[]} empty="Aucune écriture comptable." columns={[
          { header: 'Compte', render: (r) => r.code }, { header: 'Libellé', render: (r) => r.label },
          { header: 'Débit', align: 'right', render: (r) => money(r.debit) }, { header: 'Crédit', align: 'right', render: (r) => money(r.credit) },
        ]} />
      </Card>
    </>
  );
}
