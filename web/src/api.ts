export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) { super(message); }
}

const REFRESH_KEY = 'agritrace.refresh';
const ORG_KEY = 'agritrace.org';
let accessToken: string | null = null;
let orgId: string | null = (() => { try { return sessionStorage.getItem(ORG_KEY); } catch { return null; } })();
let onSessionLost: () => void = () => undefined;

// Le jeton d'accès reste en mémoire ; seul le jeton de renouvellement est gardé dans la session du navigateur (effacée à la fermeture de l'onglet).
const store = {
  get: () => { try { return sessionStorage.getItem(REFRESH_KEY); } catch { return null; } },
  set: (v: string | null) => { try { v ? sessionStorage.setItem(REFRESH_KEY, v) : sessionStorage.removeItem(REFRESH_KEY); } catch { /* stockage indisponible */ } },
};

export const setOrg = (id: string | null) => { orgId = id; try { id ? sessionStorage.setItem(ORG_KEY, id) : sessionStorage.removeItem(ORG_KEY); } catch { /* ignoré */ } };
export const getOrg = () => orgId;
export const hasStoredSession = () => !!store.get();
export const onLogout = (fn: () => void) => { onSessionLost = fn; };

/** Message lisible depuis une réponse d'erreur NestJS (chaîne ou liste de messages de validation). */
export function errorMessage(body: any, fallback: string): string {
  const m = body?.message;
  if (Array.isArray(m)) return m.join(' ; ');
  if (typeof m === 'string') return m;
  return fallback;
}

async function raw(path: string, init: RequestInit & { json?: unknown } = {}, retry = true): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (orgId) headers.set('X-Organization-Id', orgId);
  let body = init.body;
  if (init.json !== undefined) { headers.set('Content-Type', 'application/json'); body = JSON.stringify(init.json); }
  const res = await fetch(`/v1${path}`, { ...init, headers, body });
  if (res.status === 401 && retry && (await refresh())) return raw(path, init, false);
  if (res.status === 401) { clearSession(); onSessionLost(); }
  return res;
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  const token = store.get();
  if (!token) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch('/v1/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: token }) });
      if (!res.ok) return false;
      const j = await res.json();
      accessToken = j.access_token; store.set(j.refresh_token);
      return true;
    } catch { return false; } finally { refreshing = null; }
  })();
  return refreshing;
}

export function clearSession() { accessToken = null; store.set(null); }

export async function login(email: string, password: string) {
  const res = await fetch('/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, device_label: 'Portail web' }) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, res.status === 401 ? 'Identifiants invalides.' : errorMessage(body, 'Connexion impossible.'), body);
  accessToken = body.access_token; store.set(body.refresh_token);
}

/** Reprend une session existante (rechargement de page) en renouvelant le jeton. */
export const resume = () => refresh();

export async function logout() {
  const token = store.get();
  if (token) await fetch('/v1/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }, body: JSON.stringify({ refresh_token: token }) }).catch(() => undefined);
  clearSession(); setOrg(null);
}

export async function api<T = any>(method: string, path: string, json?: unknown): Promise<T> {
  const res = await raw(path, { method, json });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new ApiError(res.status, errorMessage(body, `Erreur ${res.status}`), body);
  return body as T;
}
export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b?: unknown) => api<T>('POST', p, b ?? {});

/** Téléchargement authentifié (PDF, Excel) : le jeton ne transite jamais dans une URL. */
export async function download(path: string, filename: string) {
  const res = await raw(path);
  if (!res.ok) throw new ApiError(res.status, `Téléchargement impossible (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
