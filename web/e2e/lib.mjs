// Aides communes aux parcours de navigateur : appels API, amorçage d'une coopérative de test, pilotage de la page.
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const API = process.env.API ?? 'http://localhost:3000/v1';
export const WEB = process.env.WEB ?? 'http://localhost:4173';
export const run = crypto.randomBytes(3).toString('hex').toUpperCase();
export const PW = 'MotDePasseSolide2026!';
export const PROOF = path.join(path.dirname(fileURLToPath(import.meta.url)), 'proof.png');
export const key = (p) => `${p}-${run}-${crypto.randomBytes(4).toString('hex')}`;

export async function call(method, p, { token, org, body } = {}) {
  const h = {};
  if (token) h.authorization = `Bearer ${token}`;
  if (org) h['x-organization-id'] = org;
  if (body) h['content-type'] = 'application/json';
  const r = await fetch(API + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); try { return JSON.parse(t); } catch { return t; }
}
export const must = (cond, msg, extra) => { if (!cond) throw new Error(`${msg}${extra ? ' : ' + JSON.stringify(extra).slice(0, 300) : ''}`); };

/** Coopérative de test : administrateur, filière, campagne, prix, producteur, magasin et 1300 kg de stock. */
export async function seedBase() {
  const adm = (await call('POST', '/auth/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })).access_token;
  must(adm, 'connexion administrateur de plateforme');
  const org = await call('POST', '/organizations', { token: adm, body: { code: 'UI' + run, name: 'UI ' + run } });
  const email = `ui.${run}@t.test`;
  await call('POST', `/organizations/${org.id}/admins`, { token: adm, body: { email, full_name: 'Admin UI', password: PW } });
  const T = (await call('POST', '/auth/login', { body: { email, password: PW } })).access_token;
  const J = { token: T, org: org.id };
  await call('PUT', '/purchase-declarations/settings/receipts', { ...J, body: { mode: 'physical', series: 'A', required: false } });
  const vc = await call('POST', '/value-chains', { ...J, body: { code: 'CACAO', name: 'Cacao' } });
  await call('POST', '/unit-conversions', { ...J, body: { value_chain_id: vc.id, from_unit: 'sac', to_unit: 'kg', factor: '65' } });
  const camp = await call('POST', '/campaigns', { ...J, body: { value_chain_id: vc.id, code: 'C26', name: 'Campagne', starts_on: '2025-10-01', ends_on: '2027-12-31' } });
  const sched = await call('POST', '/price-schedules', { ...J, body: { value_chain_id: vc.id, campaign_id: camp.id, unit: 'kg' } });
  await call('POST', `/price-schedules/${sched.id}/versions`, { ...J, body: { unit_price: '1000', valid_from: '2025-10-01' } });
  const prod = (await call('POST', '/producers', { ...J, body: { last_name: 'KONE', first_names: 'Awa', village: 'Hiré', value_chain_ids: [vc.id] } })).producer;
  const wh = await call('POST', '/warehouses', { ...J, body: { code: 'MAG1', name: 'Magasin 1' } });
  const rcol = await call('POST', '/roles', { ...J, body: { code: 'collecteur', name: 'Collecteur', permissions: ['declarations:create', 'declarations:read', 'producers:read', 'sync:use', 'messages:use'] } });
  const cu = await call('POST', '/users', { ...J, body: { email: `col.${run}@t.test`, full_name: 'col', password: PW, role_id: rcol.id } });
  const col = await call('POST', '/collectors', { ...J, body: { user_id: cu.id } });
  await call('POST', `/collectors/${col.id}/assignments`, { ...J, body: { value_chain_id: vc.id } });
  const tcol = (await call('POST', '/auth/login', { body: { email: `col.${run}@t.test`, password: PW } })).access_token;
  const d = { id: crypto.randomUUID(), idempotency_key: key('d'), producer_id: prod.id, value_chain_id: vc.id, campaign_id: camp.id, operation_date: '2026-02-10', bags: 20, quantity: '20', unit: 'sac' };
  await call('POST', '/sync/batch', { token: tcol, org: org.id, body: { operations: [{ idempotency_key: d.idempotency_key, type: 'purchase_declaration.create', payload: d }, { idempotency_key: key('s'), type: 'purchase_declaration.submit', payload: { id: d.id } }] } });
  await call('POST', `/purchase-declarations/${d.id}/transition`, { ...J, body: { to: 'in_review' } });
  await call('POST', `/purchase-declarations/${d.id}/transition`, { ...J, body: { to: 'accepted' } });
  const w = await call('POST', '/weighings', { ...J, body: { idempotency_key: key('w'), declaration_id: d.id, warehouse_id: wh.id, gross_kg: '1305', tare_kg: '5' } });
  const rc = await call('POST', '/receipts', { ...J, body: { weighing_id: w.id } });
  must(rc.receipt?.lot_id ?? rc.lot_id, 'mise en stock', rc);
  return { email, J, vc, prod, wh, colEmail: `col.${run}@t.test` };
}
