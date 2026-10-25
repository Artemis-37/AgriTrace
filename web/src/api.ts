export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) { super(message); }
}

import { OfflineError, cacheGet, cachePut, clearCache, configure, markOffline } from './offline';
export { OfflineError } from './offline';

const REFRESH_KEY = 'agritrace.refresh';
const ORG_KEY = 'agritrace.org';
let accessToken: string | null = null;
let orgId: string | null = (() => { try { return sessionStorage.getItem(ORG_KEY); } catch { return null; } })();
let onSessionLost: () => void = () => undefined;

// Le jeton d'accès reste en mémoire ; seul le jeton de renouvellement est gardé dans la session du navigateur (effacée à la fermeture de l'onglet).
// Sur l'application de bureau, la session survit au redémarrage du poste (indispensable pour reprendre le travail quand le serveur est éteint).
const desktop = typeof window !== 'undefined' && !!(window as any).agritrace?.desktop;
const area = () => (desktop ? localStorage : sessionStorage);
const store = {
  get: () => { try { return area().getItem(REFRESH_KEY); } catch { return null; } },
  set: (v: string | null) => { try { v ? area().setItem(REFRESH_KEY, v) : area().removeItem(REFRESH_KEY); } catch { /* stockage indisponible */ } },
};
const UID_KEY = 'agritrace.uid';
const uidOf = (jwt: string) => { try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub as string; } catch { return ''; } };
const rememberUser = (jwt: string) => { const u = uidOf(jwt); if (u) { try { area().setItem(UID_KEY, u); } catch { /* ignoré */ } configure(u, back); } };
const knownUser = () => { try { return area().getItem(UID_KEY) ?? ''; } catch { return ''; } };
let offlineSession = false;
/** Retour du réseau : on renouvelle le jeton ; si la session a été révoquée entre-temps, retour à la connexion. */
async function back(): Promise<boolean> {
  if (!offlineSession && accessToken) return true;
  const r = await refresh();
  if (r === 'ok') { offlineSession = false; return true; }
  if (r === 'denied') { clearSession(); onSessionLost(); }
  return false;
}

const DEV_KEY = 'agritrace.device';
/** Jeton propre à ce poste (obtenu avec le code d'association) ; envoyé à chaque requête. */
export const deviceToken = (): string | null => { try { return localStorage.getItem(DEV_KEY); } catch { return null; } };
export const setDeviceToken = (t: string | null) => { try { t ? localStorage.setItem(DEV_KEY, t) : localStorage.removeItem(DEV_KEY); } catch { /* ignoré */ } };
/** Échange le code d'association contre le jeton du poste (avant toute connexion). */
export async function pairWorkstation(code: string): Promise<string> {
  const res = await fetch('/v1/workstations/pair', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client': 'web' }, body: JSON.stringify({ code }) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, errorMessage(body, 'Association impossible.'), body);
  setDeviceToken(body.device_token); return body.name as string;
}

export const isOfflineSession = () => offlineSession;
export const setOrg = (id: string | null) => { orgId = id; try { id ? sessionStorage.setItem(ORG_KEY, id) : sessionStorage.removeItem(ORG_KEY); } catch { /* ignoré */ } };
export const getOrg = () => orgId;
let supportOn = false;
export const setSupport = (on: boolean) => { supportOn = on; };
export const hasStoredSession = () => !!store.get();
export const onLogout = (fn: () => void) => { onSessionLost = fn; };

/** Message lisible depuis une réponse d'erreur NestJS (chaîne ou liste de messages de validation). */
export function errorMessage(body: any, fallback: string): string {
  const m = body?.message;
  if (Array.isArray(m)) return m.join(' ; ');
  if (typeof m === 'string') return m;
  return fallback;
}

async function raw(path: string, init: RequestInit & { json?: unknown } = {}, retry = true, org: string | null = orgId): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('X-Client', 'web'); // les comptes réservés au mobile sont refusés par le serveur
  if (org) headers.set('X-Organization-Id', org);
  if (org && supportOn) headers.set('X-Support-Mode', '1'); // accès support de l'administrateur de plateforme (tracé côté serveur)
  const dev = deviceToken(); if (dev) headers.set('X-Device-Token', dev);
  let body = init.body;
  if (init.json !== undefined) { headers.set('Content-Type', 'application/json'); body = JSON.stringify(init.json); }
  let res: Response;
  try { res = await fetch(`/v1${path}`, { ...init, headers, body }); } catch { markOffline(); throw new OfflineError(); }
  if (res.status === 503 && res.headers.get('x-agritrace-offline')) { markOffline(); throw new OfflineError(); }
  if (res.status === 403 && (await res.clone().json().catch(() => null))?.code === 'workstation_required') window.dispatchEvent(new Event('agritrace:workstation-required'));
  if (res.status === 401 && retry && (await refresh()) === 'ok') return raw(path, init, false, org);
  if (res.status === 401) { clearSession(); onSessionLost(); }
  return res;
}

type RefreshResult = 'ok' | 'denied' | 'offline';
let refreshing: Promise<RefreshResult> | null = null;
async function refresh(): Promise<RefreshResult> {
  const token = store.get();
  if (!token) return 'denied';
  refreshing ??= (async () => {
    try {
      const res = await fetch('/v1/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client': 'web' }, body: JSON.stringify({ refresh_token: token }) });
      if (res.status === 503 && res.headers.get('x-agritrace-offline')) return 'offline' as const;
      if (!res.ok) return 'denied' as const;
      const j = await res.json();
      accessToken = j.access_token; store.set(j.refresh_token); offlineSession = false; rememberUser(j.access_token);
      return 'ok' as const;
    } catch { return 'offline' as const; } finally { refreshing = null; }
  })();
  return refreshing;
}

export function clearSession() { accessToken = null; store.set(null); }

export async function login(email: string, password: string, otp?: string) {
  const res = await fetch('/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client': 'web' }, body: JSON.stringify({ email, password, device_label: 'Portail web', ...(otp ? { otp } : {}) }) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, res.status === 401 && body?.code === 'OTP_REQUIRED' ? 'Code de vérification requis.' : res.status === 401 && body?.code === 'OTP_INVALID' ? 'Code de vérification invalide ou déjà utilisé.' : res.status === 401 ? 'Identifiants invalides.' : res.status === 403 && body?.code === 'MOBILE_ONLY' ? "Ce compte se connecte uniquement depuis l'application mobile AgriTrace." : errorMessage(body, 'Connexion impossible.'), body);
  accessToken = body.access_token; store.set(body.refresh_token); offlineSession = false; rememberUser(body.access_token);
}

/** Reprend une session existante (rechargement de page) en renouvelant le jeton. */
export async function resume(): Promise<boolean> {
  const r = await refresh();
  if (r === 'offline' && store.get() && knownUser()) { offlineSession = true; configure(knownUser(), back); markOffline(); return true; }
  return r === 'ok';
}

export async function logout() {
  const token = store.get();
  if (token) await fetch('/v1/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }, body: JSON.stringify({ refresh_token: token }) }).catch(() => undefined);
  clearSession(); setOrg(null); await clearCache();
}

/** `org` : organisation de l'opération (rejeu de la file) ; sinon celle de l'écran courant. Les lectures sont mises en mémoire pour le mode hors connexion. */
export async function api<T = any>(method: string, path: string, json?: unknown, org: string | null = orgId): Promise<T> {
  let res: Response;
  try { res = await raw(path, { method, json }, true, org); } catch (e) {
    if (e instanceof OfflineError && method === 'GET') {
      const hit = await cacheGet(org, path);
      if (hit) { lastStale = Math.min(lastStale || Infinity, hit.at); return hit.body as T; }
      throw new ApiError(0, 'Hors connexion : ces données n’ont pas encore été chargées sur ce poste.');
    }
    if (e instanceof OfflineError) throw new ApiError(0, 'Hors connexion : action impossible pour le moment.');
    throw e;
  }
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new ApiError(res.status, errorMessage(body, `Erreur ${res.status}`), body);
  if (method === 'GET' && body !== null && typeof body === 'object') void cachePut(org, path, body);
  return body as T;
}
let lastStale = 0;
/** Date de la plus ancienne copie servie hors connexion (0 = aucune). */
export const staleSince = () => lastStale;
export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b?: unknown) => api<T>('POST', p, b ?? {});
export const put = <T = any>(p: string, b?: unknown) => api<T>('PUT', p, b ?? {});
export const patch = <T = any>(p: string, b?: unknown) => api<T>('PATCH', p, b ?? {});

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

/** Envoi de fichier (multipart) : l'en-tête Content-Type est posé par le navigateur. */
export async function postForm<T = any>(path: string, form: FormData): Promise<T> {
  const res = await raw(path, { method: 'POST', body: form });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new ApiError(res.status, errorMessage(body, `Erreur ${res.status}`), body);
  return body as T;
}

/** Clé d'idempotence pour une action de l'utilisateur (un double clic ne crée pas de doublon). */
export const idem = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** Récupère un fichier binaire de la coopérative courante (null s'il n'existe pas). */
export async function getBlob(path: string): Promise<Blob | null> {
  const res = await raw(path);
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(res.status, `Lecture impossible (${res.status})`);
  return res.blob();
}

/** Récupère un fichier avec ses en-têtes (transfert par clé USB : numéro confirmé, nombre de lignes). */
export async function getFile(path: string): Promise<{ blob: Blob; headers: Headers; name: string }> {
  const res = await raw(path);
  if (!res.ok) { let b: any = null; try { b = await res.json(); } catch { /* corps vide */ } throw new ApiError(res.status, errorMessage(b, `Lecture impossible (${res.status})`), b); }
  const m = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '');
  return { blob: await res.blob(), headers: res.headers, name: m?.[1] ?? 'transfert.atx' };
}

export async function putForm<T = any>(path: string, form: FormData): Promise<T> {
  const res = await raw(path, { method: 'PUT', body: form });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new ApiError(res.status, errorMessage(body, res.status === 413 ? 'Fichier trop lourd (1 Mo maximum)' : `Erreur ${res.status}`), body);
  return body as T;
}

export async function del<T = any>(path: string): Promise<T> {
  const res = await raw(path, { method: 'DELETE' });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new ApiError(res.status, errorMessage(body, `Erreur ${res.status}`), body);
  return body as T;
}
