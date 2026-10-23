-- Produits (prix d'achat et de vente au kilo) ; chaque pesée est rattachée à un produit et à une campagne (table campaigns existante).
BEGIN;
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  buy_price_per_kg numeric(14,2) CHECK (buy_price_per_kg IS NULL OR buy_price_per_kg >= 0),
  sell_price_per_kg numeric(14,2) CHECK (sell_price_per_kg IS NULL OR sell_price_per_kg >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid
);
CREATE UNIQUE INDEX uq_products_name ON products (organization_id, lower(name));
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON products USING (organization_id::text = current_setting('app.current_org', true)) WITH CHECK (organization_id::text = current_setting('app.current_org', true));
ALTER TABLE convoy_receptions ADD COLUMN product_id uuid REFERENCES products(id), ADD COLUMN campaign_id uuid REFERENCES campaigns(id);

INSERT INTO permissions(code, description) VALUES
 ('products:read','Consulter les produits et leurs prix d''achat et de vente'),
 ('products:manage','Gérer les produits (prix d''achat et de vente au kilo)');
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, 'products:read' FROM roles r WHERE r.code IN ('coop_admin','adg','magasinier','caissier','comptable','direction','responsable_magasin','responsable_financier') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, 'products:manage' FROM roles r WHERE r.code IN ('coop_admin','adg','direction') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, 'campaigns:read' FROM roles r WHERE r.code IN ('magasinier','caissier','comptable','direction','responsable_magasin','responsable_financier') ON CONFLICT DO NOTHING;
COMMIT;
