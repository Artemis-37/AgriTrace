-- Le prix au kilo d'un produit n'est fixé que par l'administrateur de la coopérative (à l'ouverture de la traite, puis actualisé) ;
-- chaque changement est conservé (historique) et le prix en vigueur est repris par la caisse et les autres écrans.
BEGIN;
CREATE TABLE product_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES campaigns(id),
  buy_price_per_kg numeric(14,2) CHECK (buy_price_per_kg IS NULL OR buy_price_per_kg >= 0),
  sell_price_per_kg numeric(14,2) CHECK (sell_price_per_kg IS NULL OR sell_price_per_kg >= 0),
  valid_from date NOT NULL DEFAULT current_date,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_product_prices ON product_prices(product_id, campaign_id, created_at DESC);
ALTER TABLE product_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON product_prices USING (organization_id::text = current_setting('app.current_org', true)) WITH CHECK (organization_id::text = current_setting('app.current_org', true));
INSERT INTO product_prices(organization_id, product_id, buy_price_per_kg, sell_price_per_kg)
  SELECT organization_id, id, buy_price_per_kg, sell_price_per_kg FROM products WHERE buy_price_per_kg IS NOT NULL OR sell_price_per_kg IS NOT NULL;
-- Prix, produits et campagnes : administrateur de la coopérative seul.
DELETE FROM role_permissions WHERE permission_code IN ('products:manage','prices:manage','campaigns:manage') AND role_id IN (SELECT id FROM roles WHERE code <> 'coop_admin');
COMMIT;
