-- Association explicite produit ↔ traite : chaque produit est vendu/acheté dans une ou plusieurs traites (le prix se fixe par traite).
BEGIN;
CREATE TABLE campaign_products (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  PRIMARY KEY (campaign_id, product_id)
);
-- Reprise de l'existant (avant d'activer la sécurité par organisation, qui s'applique aussi au propriétaire) : tout produit déjà doté d'un prix pour une traite lui est associé.
INSERT INTO campaign_products(organization_id, campaign_id, product_id)
  SELECT DISTINCT organization_id, campaign_id, product_id FROM product_prices WHERE campaign_id IS NOT NULL ON CONFLICT DO NOTHING;
ALTER TABLE campaign_products ENABLE ROW LEVEL SECURITY; ALTER TABLE campaign_products FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON campaign_products USING (organization_id::text = current_setting('app.current_org', true)) WITH CHECK (organization_id::text = current_setting('app.current_org', true));
SELECT replication_install_triggers();
COMMIT;
