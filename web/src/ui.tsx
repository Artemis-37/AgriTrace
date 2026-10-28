import { DependencyList, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Tone } from './format';

export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => id === seq.current && setState({ data, error: null, loading: false }))
        .catch((e: Error) => id === seq.current && setState({ data: null, error: e.message || 'Erreur inconnue', loading: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(run, [run]);
  return { ...state, reload: run };
}

export const PageHeader = ({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) => (
  <header className="page-header">
    <div><h1>{title}</h1>{subtitle && <p className="muted">{subtitle}</p>}</div>
    {actions && <div className="actions">{actions}</div>}
  </header>
);

export const Card = ({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) => (
  <section className={`card ${className}`}>{title && <h2>{title}</h2>}{children}</section>
);

export const Badge = ({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) => <span className={`badge badge-${tone}`}>{children}</span>;
export const StatusBadge = ({ map, value }: { map: Record<string, [string, Tone]>; value: string | null | undefined }) => {
  if (!value) return <>—</>;
  const [label, tone] = map[value] ?? [value, 'neutral' as Tone];
  return <Badge tone={tone}>{label}</Badge>;
};

export const ErrorBox = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div role="alert" className="error-box">{message}{onRetry && <button className="btn btn-ghost" onClick={onRetry}>Réessayer</button>}</div>
);
export const Loading = () => <p className="muted" aria-live="polite">Chargement…</p>;
export const Empty = ({ children }: { children: ReactNode }) => <p className="empty">{children}</p>;

export interface Column<T> { header: string; render: (row: T) => ReactNode; align?: 'right'; className?: string }
export function Table<T extends object>({ rows, columns, empty = 'Aucun élément.', rowClass }: { rows: T[]; columns: Column<T>[]; empty?: string; rowClass?: (row: T) => string | undefined }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{columns.map((c) => <th key={c.header} className={c.align === 'right' ? 'num' : ''}>{c.header}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={(r as { id?: string }).id ?? i} className={rowClass?.(r)}>{columns.map((c) => <td key={c.header} className={`${c.align === 'right' ? 'num' : ''} ${c.className ?? ''}`}>{c.render(r)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={wide ? 'modal modal-wide' : 'modal'} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button className="btn btn-ghost" onClick={onClose} aria-label="Fermer">✕</button></div>
        {children}
      </div>
    </div>
  );
}

export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <label className="field"><span>{label}</span>{children}{hint && <small className="muted">{hint}</small>}</label>
);

/** Exécute une action avec état « en cours » et message d'erreur lisible. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); return true; } catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  };
  return { busy, error, run, clear: () => setError(null) };
}

export const Stat = ({ label, value, tone = 'neutral', hint }: { label: string; value: ReactNode; tone?: Tone; hint?: string }) => (
  <div className={`stat stat-${tone}`}><div className="stat-value">{value}</div><div className="stat-label">{label}</div>{hint && <small className="muted">{hint}</small>}</div>
);

export function Tabs<K extends string>({ tabs, value, onChange }: { tabs: [K, string][]; value: K; onChange: (k: K) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)}>{label}</button>)}
    </div>
  );
}

/** Classe de couleur d'un solde de délégué : positif = le délégué doit à la coopérative (rouge) ; négatif = la coopérative lui doit (bleu). */
export const soldeClass = (v: number | string | null | undefined) => (Number(v) > 0 ? 's-doit' : Number(v) < 0 ? 's-du' : '');
