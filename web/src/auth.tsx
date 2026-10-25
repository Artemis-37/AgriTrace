import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as client from './api';

export interface Org { id: string; code: string; name: string; kind?: 'cooperative' | 'exporter' }
interface Me { user: { id: string; email: string; full_name: string }; must_change_password?: boolean; must_setup_2fa?: boolean; permissions: string[]; account_kind?: 'collector' | 'coach' | 'staff'; mobile_first?: boolean }
interface AuthState {
  status: 'loading' | 'anonymous' | 'choose-org' | 'ready' | 'platform';
  orgs: Org[]; org: Org | null; me: Me | null;
  signIn: (email: string, password: string, otp?: string) => Promise<void>;
  chooseOrg: (id: string) => Promise<void>;
  /** Administrateur de plateforme : entre dans une organisation avec tous les droits (accès support, tracé). */
  enterSupport: (o: Org) => Promise<void>;
  exitSupport: () => void;
  support: boolean;
  signOut: () => Promise<void>;
  can: (...perms: string[]) => boolean;
}
const Ctx = createContext<AuthState | null>(null);
export const useAuth = () => { const v = useContext(Ctx); if (!v) throw new Error('AuthProvider manquant'); return v; };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [org, setOrgState] = useState<Org | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [support, setSupportState] = useState(false);

  const enter = useCallback(async (list: Org[], id: string) => {
    client.setOrg(id);
    const m = await client.get<Me>('/me');
    setMe(m); setOrgState(list.find((o) => o.id === id) ?? null); setStatus('ready');
  }, []);

  const afterLogin = useCallback(async () => {
    const list = await client.get<Org[]>('/organizations');
    setOrgs(list);
    const saved = client.getOrg();
    if (saved && list.some((o) => o.id === saved)) return enter(list, saved);
    if (list.length === 1) return enter(list, list[0].id);
    client.setOrg(null);
    if (!list.length) {
      // Administrateur de plateforme : pas de coopérative, mais la console du serveur central.
      const pf = await client.get<{ is_platform_admin: boolean; full_name: string }>('/me/platform').catch(() => null);
      if (pf?.is_platform_admin) { setMe({ user: { id: '', email: '', full_name: pf.full_name }, permissions: [] }); setStatus('platform'); return; }
      setStatus('anonymous');
    } else setStatus('choose-org');
    if (!list.length) throw new client.ApiError(403, "Ce compte n'est rattaché à aucune coopérative.");
  }, [enter]);

  useEffect(() => {
    client.onLogout(() => { setStatus('anonymous'); setMe(null); setOrgState(null); });
    (async () => {
      if (client.hasStoredSession() && (await client.resume())) { try { await afterLogin(); return; } catch { /* retombe sur la connexion */ } }
      setStatus('anonymous');
    })();
  }, [afterLogin]);

  // La caissière se connecte par l'écran de connexion du logiciel : la caisse est alors ouverte à son nom (sans fonds ni comptage).
  const cashierId = me?.permissions.includes('cash:session') ? me.user.id : null;
  useEffect(() => {
    if (!cashierId) return;
    (async () => { try { for (const r of await client.get<any[]>('/cash-registers')) if (!r.open_session_id) await client.post(`/cash-registers/${r.id}/sessions`, {}); } catch { /* sans incidence */ } })();
  }, [cashierId]);

  // Application de bureau : à la fermeture de la fenêtre, le logiciel demande la déconnexion.
  const signOutRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => { (window as any).agritrace?.onSignOut?.(() => signOutRef.current().catch(() => undefined)); }, []);

  const value = useMemo<AuthState>(() => ({
    status, orgs, org, me,
    signIn: async (email, password, otp) => {
      await client.login(email, password, otp);
      try { await afterLogin(); } catch (e: any) {
        // Compte réservé au mobile détecté après la connexion (rôle personnalisé) : on ferme la session et on l'explique.
        if (e?.body?.code === 'MOBILE_ONLY') { await client.logout(); setStatus('anonymous'); setMe(null); setOrgState(null); throw new client.ApiError(403, "Ce compte se connecte uniquement depuis l'application mobile AgriTrace."); }
        throw e;
      }
    },
    chooseOrg: (id) => enter(orgs, id),
    support,
    enterSupport: async (o) => {
      client.setSupport(true); client.setOrg(o.id);
      try { const m = await client.get<Me>('/me'); setMe(m); setOrgState(o); setSupportState(true); setStatus('ready'); }
      catch (e) { client.setSupport(false); client.setOrg(null); throw e; }
    },
    exitSupport: () => {
      client.setSupport(false); client.setOrg(null); setSupportState(false); setOrgState(null);
      setMe({ user: { id: '', email: '', full_name: me?.user.full_name ?? '' }, permissions: [] }); setStatus('platform');
    },
    signOut: async () => {
      // La déconnexion ferme aussi la caisse de la caissière (côté serveur).
      await client.logout(); setStatus('anonymous'); setMe(null); setOrgState(null); },
    can: (...perms) => perms.every((p) => me?.permissions.includes(p)),
  }), [status, orgs, org, me, support, afterLogin, enter]);

  signOutRef.current = async () => { if (me) await value.signOut(); };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
