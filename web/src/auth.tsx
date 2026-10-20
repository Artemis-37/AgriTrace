import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as client from './api';

export interface Org { id: string; code: string; name: string }
interface Me { user: { id: string; email: string; full_name: string }; permissions: string[]; account_kind?: 'collector' | 'coach' | 'staff'; mobile_first?: boolean }
interface AuthState {
  status: 'loading' | 'anonymous' | 'choose-org' | 'ready' | 'platform';
  orgs: Org[]; org: Org | null; me: Me | null;
  signIn: (email: string, password: string) => Promise<void>;
  chooseOrg: (id: string) => Promise<void>;
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

  const value = useMemo<AuthState>(() => ({
    status, orgs, org, me,
    signIn: async (email, password) => { await client.login(email, password); await afterLogin(); },
    chooseOrg: (id) => enter(orgs, id),
    signOut: async () => { await client.logout(); setStatus('anonymous'); setMe(null); setOrgState(null); },
    can: (...perms) => perms.every((p) => me?.permissions.includes(p)),
  }), [status, orgs, org, me, afterLogin, enter]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
