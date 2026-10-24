import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Fenêtres liées : un écran peut en ouvrir un autre PAR-DESSUS lui (fiche d'un producteur, fiche d'un délégué,
 * évolution d'un compte…), sans quitter l'écran d'origine : on le retrouve tel quel en fermant la fenêtre.
 * Les fenêtres s'empilent (« ← Retour » ramène à la précédente) et un fil d'Ariane rappelle d'où l'on vient.
 */
interface Win { title: string; node: ReactNode; path?: string }
interface PeekApi { open: (title: string, node: ReactNode, opts?: { path?: string }) => void }
const Ctx = createContext<PeekApi>({ open: () => undefined });
export const usePeek = () => useContext(Ctx);

export function PeekProvider({ origin, resetKey, children }: { origin: string; resetKey: string; children: ReactNode }) {
  const [stack, setStack] = useState<Win[]>([]);
  useEffect(() => setStack([]), [resetKey]); // changer d'écran ferme les fenêtres liées
  const nav = useNavigate();
  const open = useCallback((title: string, node: ReactNode, opts?: { path?: string }) => setStack((s) => [...s, { title, node, path: opts?.path }]), []);
  const back = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const closeAll = useCallback(() => setStack([]), []);
  const api = useMemo(() => ({ open }), [open]);
  useEffect(() => {
    if (!stack.length) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); back(); } };
    document.addEventListener('keydown', h, true);
    return () => document.removeEventListener('keydown', h, true);
  }, [stack.length, back]);
  const top = stack[stack.length - 1];
  return (
    <Ctx.Provider value={api}>
      {children}
      {top && (
        <div className="peek-backdrop" onMouseDown={(e) => e.target === e.currentTarget && back()}>
          <div className={`peek${top.path ? ' peek-wide' : ''}`} role="dialog" aria-modal="true" aria-label={top.title}>
            <div className="peek-head">
              {stack.length > 1 && <button className="btn btn-ghost btn-small" onClick={back}>← Retour</button>}
              <nav className="peek-crumbs" aria-label="Chemin">
                <span>{origin}</span>
                {stack.map((w, i) => <span key={i}> › {i === stack.length - 1 ? <strong>{w.title}</strong> : w.title}</span>)}
              </nav>
              {top.path && <button className="btn btn-ghost btn-small" onClick={() => { const to = top.path!; closeAll(); nav(to); }} aria-label="Ouvrir en plein écran">↗ Plein écran</button>}
              <button className="btn btn-ghost btn-small" onClick={closeAll} aria-label="Fermer et revenir à l'écran d'origine">✕ Fermer</button>
            </div>
            <div className="peek-body">{top.node}</div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

/** Texte cliquable qui ouvre un autre écran dans une fenêtre liée. */
export function PeekLink({ title, label, render, disabled }: { title: string; label: ReactNode; render: () => ReactNode; disabled?: boolean }) {
  const { open } = usePeek();
  if (disabled) return <>{label}</>;
  return <button type="button" className="link peek-link" title={`Ouvrir : ${title}`} onClick={() => open(title, render())}>{label}</button>;
}
