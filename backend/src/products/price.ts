import { PoolClient } from 'pg';

/**
 * Prix d'achat au kilo en vigueur : dernier prix fixé pour la campagne (la traite) de la pesée, sinon dernier prix général, sinon prix actuel du produit.
 * Le prix n'est saisi que par l'administrateur de la coopérative ; la caisse et les autres écrans le reprennent d'ici.
 */
export async function effectiveBuyPrice(c: PoolClient, productId: string | null, campaignId: string | null): Promise<string | null> {
  if (!productId) return null;
  const r = (await c.query(
    `SELECT coalesce(
       (SELECT buy_price_per_kg FROM product_prices WHERE product_id = $1 AND campaign_id = $2 AND buy_price_per_kg IS NOT NULL ORDER BY created_at DESC LIMIT 1),
       (SELECT buy_price_per_kg FROM product_prices WHERE product_id = $1 AND campaign_id IS NULL AND buy_price_per_kg IS NOT NULL ORDER BY created_at DESC LIMIT 1),
       (SELECT buy_price_per_kg FROM products WHERE id = $1)) AS p`, [productId, campaignId])).rows[0];
  return r?.p ?? null;
}

/** Prix de vente au kilo en vigueur (même règle que le prix d'achat) : fixé par l'administrateur, repris dans les commandes de vente. */
export async function effectiveSellPrice(c: PoolClient, productId: string | null, campaignId: string | null): Promise<string | null> {
  if (!productId) return null;
  const r = (await c.query(
    `SELECT coalesce(
       (SELECT sell_price_per_kg FROM product_prices WHERE product_id = $1 AND campaign_id = $2 AND sell_price_per_kg IS NOT NULL ORDER BY created_at DESC LIMIT 1),
       (SELECT sell_price_per_kg FROM product_prices WHERE product_id = $1 AND campaign_id IS NULL AND sell_price_per_kg IS NOT NULL ORDER BY created_at DESC LIMIT 1),
       (SELECT sell_price_per_kg FROM products WHERE id = $1)) AS p`, [productId, campaignId])).rows[0];
  return r?.p ?? null;
}
