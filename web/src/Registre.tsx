import { ReactNode, useEffect, useRef } from 'react';
import { Card, Empty, PageHeader } from './ui';

export interface RegistreColumn<T> { header: string; render: (row: T) => ReactNode; align?: 'right'; wide?: boolean }

/**
 * Écran de registre « logiciel de gestion » : liste en haut (une ligne = une fiche, compteur en bas), boutons d'action à droite,
 * fiche détaillée à onglets en dessous. Utilisé pour les délégués et les producteurs.
 */
export function Registre<T extends { id: string }>({ title, subtitle, toolbar, rows, columns, selectedId, onSelect, actions, count, empty, rowClass, footer, children }: {
  title: string; subtitle?: string; toolbar?: ReactNode; rows: T[]; columns: RegistreColumn<T>[]; selectedId: string | null; onSelect: (row: T) => void;
  actions?: ReactNode; count?: number; empty?: string; rowClass?: (row: T) => string | undefined; footer?: ReactNode; children?: ReactNode;
}) {
  const sel = useRef<HTMLTableRowElement>(null);
  useEffect(() => { sel.current?.scrollIntoView({ block: 'nearest' }); }, [selectedId]);
  const move = (d: number) => {
    if (!rows.length) return;
    const i = rows.findIndex((r) => r.id === selectedId);
    onSelect(rows[Math.max(0, Math.min(rows.length - 1, i < 0 ? 0 : i + d))]);
  };
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <Card>
        <div className="registre-top">
          <div className="registre-main">
            {toolbar && <div className="registre-bar">{toolbar}</div>}
            <div className="registre-grid" tabIndex={0} role="grid" aria-label={title}
              onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); move(1); } else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); } }}>
              {rows.length === 0 ? <Empty>{empty ?? 'Aucune fiche.'}</Empty> : (
                <table>
                  <thead><tr><th className="num">N°</th>{columns.map((c) => <th key={c.header} className={c.align === 'right' ? 'num' : ''}>{c.header}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.id} ref={r.id === selectedId ? sel : undefined} className={`${r.id === selectedId ? 'on' : ''} ${rowClass?.(r) ?? ''}`} aria-selected={r.id === selectedId} onClick={() => onSelect(r)}>
                        <td className="num">{i + 1}</td>
                        {columns.map((c) => <td key={c.header} className={c.align === 'right' ? 'num' : ''}>{c.render(r)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="registre-count">{footer}<span>Nombre</span><strong>{(count ?? rows.length).toLocaleString('fr-FR')}</strong></div>
          </div>
          {actions && <div className="registre-actions">{actions}</div>}
        </div>
        <div className="registre-detail">{children}</div>
      </Card>
    </>
  );
}

/** Ligne de fiche : libellé à gauche, valeur dans un champ en lecture seule (comme un formulaire de logiciel de gestion). */
export const FicheRow = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="fiche-row"><span className="fiche-label">{label}</span><div className="fiche-value">{children ?? '—'}</div></div>
);
