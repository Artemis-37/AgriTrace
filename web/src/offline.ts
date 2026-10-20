// Fonctionnement hors connexion d'un poste : mémoire des dernières lectures et file d'opérations à rejouer.
//  - Lectures : chaque GET réussi est gardé (IndexedDB) ; hors connexion, la dernière copie est servie, signalée comme « ancienne ».
//  - Écritures : seules les opérations prévues pour le rejeu sûr (saisie d'achat, message) sont mises en file. Elles partent par
//    /sync/batch avec leur clé d'idempotence : un renvoi ne crée jamais de doublon, et le serveur revérifie droits et règles.
import { useSyncExternalStore } from 'react';

export type OpStatus = 'pending' | 'accepted' | 'rejected' | 'to_correct' | 'conflict' | 'pending_validation';
export interface QueuedOp { id: string; uid: string; org: string; type: string; payload: Record<string, any>; label: string; createdAt: string; status: OpStatus; error?: string }
export class OfflineError extends Error { constructor() { super('Hors connexion'); } }

const DB = 'agritrace-offline';
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('cache'); r.result.createObjectStore('outbox', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode); const rq = fn(t.objectStore(store));
    t.oncomplete = () => { db.close(); res(rq ? (rq.result as T) : undefined); }; t.onerror = () => { db.close(); rej(t.error); };
  });
}

// ---------- état observable ----------
interface State { offline: boolean; pending: number; failed: number; flushing: boolean; ops: QueuedOp[] }
let state: State = { offline: false, pending: 0, failed: 0, flushing: false, ops: [] };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
export const useOffline = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state);
export const isOffline = () => state.offline;

let currentUid = '';
let refreshHook: () => Promise<boolean> = async () => true;
let probeTimer: ReturnType<typeof setInterval> | undefined;
/** Branché par api.ts : identifiant de l'utilisateur courant et renouvellement du jeton au retour du réseau. */
export function configure(uid: string, onBack: () => Promise<boolean>) { currentUid = uid; refreshHook = onBack; void loadOps(); }

export function markOffline() {
  if (!state.offline) set({ offline: true });
  if (!probeTimer) probeTimer = setInterval(probe, 8000);
}
async function probe() {
  try {
    const r = await fetch('/v1/ready', { cache: 'no-store' });
    if (!r.ok || r.headers.get('x-agritrace-offline')) return;
  } catch { return; }
  if (probeTimer) { clearInterval(probeTimer); probeTimer = undefined; }
  set({ offline: false });
  if (await refreshHook().catch(() => false)) await flush();
}
if (typeof window !== 'undefined') window.addEventListener('online', () => { if (state.offline) void probe(); });

// ---------- lectures mises en mémoire ----------
const ckey = (org: string | null, path: string) => `${currentUid}|${org ?? ''}|${path}`;
export async function cachePut(org: string | null, path: string, body: unknown) {
  try { await tx('cache', 'readwrite', (s) => s.put({ at: Date.now(), body }, ckey(org, path))); } catch { /* mémoire indisponible : sans effet */ }
}
export async function cacheGet(org: string | null, path: string): Promise<{ at: number; body: unknown } | undefined> {
  try { return (await tx('cache', 'readonly', (s) => s.get(ckey(org, path)))) as any; } catch { return undefined; }
}
/** À la déconnexion volontaire : les lectures de cet utilisateur sont effacées ; la file d'envoi, elle, est conservée. */
export async function clearCache() {
  try { await tx('cache', 'readwrite', (s) => s.clear()); } catch { /* ignoré */ }
}

// ---------- file d'opérations ----------
async function loadOps() {
  try {
    const all = ((await tx('outbox', 'readonly', (s) => s.getAll())) ?? []) as QueuedOp[];
    const mine = all.filter((o) => o.uid === currentUid).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    set({ ops: mine, pending: mine.filter((o) => o.status === 'pending').length, failed: mine.filter((o) => !['pending', 'accepted'].includes(o.status)).length });
  } catch { /* ignoré */ }
}
const putOp = (o: QueuedOp) => tx('outbox', 'readwrite', (s) => s.put(o));
export async function removeOp(id: string) { await tx('outbox', 'readwrite', (s) => s.delete(id)); await loadOps(); }

/** Met une opération en file ; si le serveur répond, elle part aussitôt. */
export async function enqueue(org: string, type: string, payload: Record<string, any>, label: string): Promise<QueuedOp> {
  const id = (payload.idempotency_key as string) || (crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const op: QueuedOp = { id, uid: currentUid, org, type, payload: { ...payload, idempotency_key: id }, label, createdAt: new Date().toISOString(), status: 'pending' };
  await putOp(op); await loadOps();
  if (!state.offline) void flush();
  return op;
}

let flushing = false;
export async function flush() {
  if (flushing || state.offline) return;
  flushing = true; set({ flushing: true });
  try {
    const todo = state.ops.filter((o) => o.status === 'pending');
    // Par coopérative : l'en-tête d'organisation est celui de l'opération, pas celui de l'écran courant.
    for (const org of [...new Set(todo.map((o) => o.org))]) {
      const batch = todo.filter((o) => o.org === org).slice(0, 50);
      const { api } = await import('./api');
      const res = await api<{ results: { idempotency_key: string; status: OpStatus | 'received'; error?: string; retry?: boolean }[] }>('POST', '/sync/batch',
        { operations: batch.map((o) => ({ idempotency_key: o.id, type: o.type, payload: o.payload })) }, org);
      for (const r of res.results) {
        const op = batch.find((o) => o.id === r.idempotency_key); if (!op || r.status === 'received' || r.retry) continue;
        await putOp({ ...op, status: r.status as OpStatus, error: r.error });
      }
    }
  } catch (e) {
    if (e instanceof OfflineError || (e as any)?.status === 0) markOffline();
  } finally { flushing = false; set({ flushing: false }); await loadOps(); notifyDone(); }
}
const doneFns = new Set<() => void>();
/** Pour recharger un écran quand des opérations viennent d'être acceptées. */
export const onFlushed = (f: () => void) => { doneFns.add(f); return () => { doneFns.delete(f); }; };
const notifyDone = () => doneFns.forEach((f) => f());
