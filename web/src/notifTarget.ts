import { useSearchParams } from 'react-router-dom';

/**
 * Page de traitement de chaque type de notification : chemin, onglet à ouvrir et, quand la notification
 * porte sur un élément précis, ouverture directe de son détail (`open`).
 */
const BY_KIND: Record<string, { to: string; tab?: string; open?: boolean }> = {
  convoy_created: { to: '/convois', tab: 'receive' }, convoy_received: { to: '/convois', tab: 'cash' }, convoy_variance: { to: '/convois', tab: 'variance' }, convoy_received_mine: { to: '/convois', tab: 'list' },
  convoy_settled: { to: '/convois', tab: 'mine' }, collector_advance: { to: '/convois', tab: 'mine' },
  counts_to_approve: { to: '/inventaire' }, stock_count_gap: { to: '/inventaire' }, stock_count_rejected: { to: '/inventaire' },
  declarations_waiting: { to: '/declarations' }, receipt_duplicate: { to: '/declarations' }, duplicate_near: { to: '/declarations' },
  geo_anomaly: { to: '/cartographie', tab: 'anomalies' }, geo_anomalies_open: { to: '/cartographie', tab: 'anomalies' }, geo_import_issues: { to: '/cartographie', tab: 'import' },
  invoice_overdue: { to: '/commerce', tab: 'invoices', open: true },
  shipment_to_validate: { to: '/commerce', tab: 'shipments', open: true }, shipment_discrepancy: { to: '/commerce', tab: 'shipments', open: true },
  shipment_incident: { to: '/commerce', tab: 'shipments', open: true }, shipment_late: { to: '/commerce', tab: 'shipments', open: true },
  loan_due: { to: '/finances', tab: 'loans' }, loans_to_approve: { to: '/finances', tab: 'loans' },
  parcels_pending: { to: '/parcelles' }, weighing_variance: { to: '/stocks' }, stock_negative: { to: '/stocks' },
  role_changed: { to: '/equipe' }, user_suspended: { to: '/equipe' },
  task_assigned: { to: '/missions', tab: 'tasks' }, task_overdue: { to: '/missions', tab: 'tasks' }, task_submitted: { to: '/missions', tab: 'tasks' }, task_to_correct: { to: '/missions', tab: 'tasks' },
  cancellation_request: { to: '/operations', tab: 'requests' }, cancellation_decided: { to: '/operations', tab: 'requests' },
  report_ready: { to: '/rapports', tab: 'runs' },
  task_request: { to: '/missions', tab: 'requests' }, task_request_decided: { to: '/missions', tab: 'requests' },
};
const BY_ENTITY: Record<string, string> = {
  convoy: '/convois', collector: '/convois', task: '/missions', invoice: '/commerce', shipment: '/commerce', lot: '/stocks', weighing: '/stocks',
  loan: '/finances', parcel: '/parcelles', producer: '/producteurs', message: '/messages',
};

/** Adresse de la page qui traite la notification (`/notifications` si le type est inconnu). */
export function targetOf(n: { kind?: string; entity_type?: string | null; entity_id?: string | null }): string {
  const k = n.kind ? BY_KIND[n.kind] : undefined;
  if (!k) return BY_ENTITY[n.entity_type ?? ''] ?? '/notifications';
  const q = new URLSearchParams();
  if (k.tab) q.set('tab', k.tab);
  if (k.open && n.entity_id) q.set('open', n.entity_id);
  const s = q.toString();
  return s ? `${k.to}?${s}` : k.to;
}

/** Onglet et élément demandés par l'adresse (ouverture depuis une notification) ; l'onglet n'est retenu que s'il est permis. */
export function useDeepLink(allowed?: readonly string[]) {
  const [sp] = useSearchParams();
  const tab = sp.get('tab');
  return { tab: tab && (!allowed || allowed.includes(tab)) ? tab : null, open: sp.get('open') };
}
