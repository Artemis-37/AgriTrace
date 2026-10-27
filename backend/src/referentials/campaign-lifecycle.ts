import { PoolClient } from 'pg';

/** Bilan d'une traite : quantités pesées, montants réglés, achats déclarés, producteurs concernés, par produit. */
export async function campaignSummary(c: PoolClient, id: string) {
  const camp = (await c.query(`SELECT id, code, name, traite, starts_on::text AS starts_on, ends_on::text AS ends_on, status FROM campaigns WHERE id = $1`, [id])).rows[0];
  if (!camp) return null;
  const rec = (await c.query(
    `SELECT p.id AS product_id, p.name, coalesce(sum(r.total_kg),0)::float8 AS kg, coalesce(sum(r.bags),0)::int AS bags,
            coalesce(sum(r.amount),0)::float8 AS amount, count(*)::int AS receptions
       FROM convoy_receptions r LEFT JOIN products p ON p.id = r.product_id WHERE r.campaign_id = $1 GROUP BY p.id, p.name ORDER BY p.name`, [id])).rows;
  const dec = (await c.query(
    `SELECT count(*)::int AS n, coalesce(sum(quantity),0)::float8 AS kg, coalesce(sum(amount),0)::float8 AS amount, count(DISTINCT producer_id)::int AS producers
       FROM purchase_declarations WHERE campaign_id = $1 AND status IN ('accepted','partially_received','received_confirmed')`, [id])).rows[0];
  const open = (await c.query(`SELECT count(*)::int AS n FROM purchase_declarations WHERE campaign_id = $1 AND status IN ('draft','received','in_review','to_correct')`, [id])).rows[0].n;
  const prices = (await c.query(
    `SELECT p.name, (SELECT x.buy_price_per_kg::float8 FROM product_prices x WHERE x.product_id = p.id AND x.campaign_id = $1 AND x.buy_price_per_kg IS NOT NULL ORDER BY x.created_at DESC LIMIT 1) AS buy,
            (SELECT x.sell_price_per_kg::float8 FROM product_prices x WHERE x.product_id = p.id AND x.campaign_id = $1 AND x.sell_price_per_kg IS NOT NULL ORDER BY x.created_at DESC LIMIT 1) AS sell
       FROM campaign_products cp JOIN products p ON p.id = cp.product_id WHERE cp.campaign_id = $1 ORDER BY p.name`, [id])).rows;
  return {
    campaign: camp, generated_at: new Date().toISOString(), by_product: rec, final_prices: prices,
    totals: { kg: rec.reduce((s, r) => s + r.kg, 0), bags: rec.reduce((s, r) => s + r.bags, 0), amount: rec.reduce((s, r) => s + r.amount, 0), receptions: rec.reduce((s, r) => s + r.receptions, 0) },
    declarations: { accepted: dec.n, kg: dec.kg, amount: dec.amount, producers: dec.producers, still_open: open },
  };
}

/** Copie les produits et les derniers prix d'une traite vers une autre (prix modifiables ensuite). */
export async function copyCampaignPrices(c: PoolClient, orgId: string, fromId: string, toId: string, userId: string) {
  await c.query(`INSERT INTO campaign_products(organization_id, campaign_id, product_id, created_by) SELECT $1, $3, product_id, $4 FROM campaign_products WHERE campaign_id = $2 ON CONFLICT DO NOTHING`, [orgId, fromId, toId, userId]);
  const r = await c.query(
    `INSERT INTO product_prices(organization_id, product_id, campaign_id, buy_price_per_kg, sell_price_per_kg, created_by)
     SELECT $1, cp.product_id, $3,
       (SELECT x.buy_price_per_kg FROM product_prices x WHERE x.product_id = cp.product_id AND x.campaign_id = $2 AND x.buy_price_per_kg IS NOT NULL ORDER BY x.created_at DESC LIMIT 1),
       (SELECT x.sell_price_per_kg FROM product_prices x WHERE x.product_id = cp.product_id AND x.campaign_id = $2 AND x.sell_price_per_kg IS NOT NULL ORDER BY x.created_at DESC LIMIT 1), $4
       FROM campaign_products cp WHERE cp.campaign_id = $2
        AND EXISTS (SELECT 1 FROM product_prices x WHERE x.product_id = cp.product_id AND x.campaign_id = $2)`, [orgId, fromId, toId, userId]);
  return r.rowCount ?? 0;
}

/** Ouvre les traites planifiées dont la date de début est arrivée, clôture celles dont la fin est dépassée (avec bilan). */
export async function runCampaignLifecycle(c: PoolClient) {
  const opened = (await c.query(`UPDATE campaigns SET status = 'open', updated_at = now() WHERE status = 'planned' AND starts_on <= current_date AND ends_on >= current_date RETURNING id, name`)).rows;
  const closed: { id: string; name: string }[] = [];
  for (const k of (await c.query(`SELECT id, name FROM campaigns WHERE status = 'open' AND ends_on < current_date`)).rows) {
    const summary = await campaignSummary(c, k.id);
    await c.query(`UPDATE campaigns SET status = 'closed', closed_at = now(), closing_summary = $2, updated_at = now() WHERE id = $1`, [k.id, JSON.stringify(summary)]);
    closed.push(k);
  }
  const ending = (await c.query(`SELECT id, name, ends_on::text AS ends_on, (ends_on - current_date)::int AS days FROM campaigns WHERE status = 'open' AND ends_on >= current_date AND ends_on <= current_date + $1::int`,
    [Number(process.env.CAMPAIGN_ALERT_DAYS ?? 15)])).rows;
  return { opened, closed, ending };
}
