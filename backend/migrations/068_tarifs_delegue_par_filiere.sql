-- Tarifs du délégué par filière : un délégué qui achète plusieurs filières peut avoir un coût de transport et une retenue au kilo propres à chacune.
-- Ordre de reprise à la caisse : tarif de la filière du produit → tarif général du délégué → tarif par défaut de la coopérative (champ par champ).
BEGIN;
CREATE TABLE collector_rates (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  collector_id uuid NOT NULL REFERENCES collectors(id) ON DELETE CASCADE,
  value_chain_id uuid NOT NULL REFERENCES value_chains(id),
  transport_per_kg numeric(18,4) CHECK (transport_per_kg IS NULL OR transport_per_kg >= 0),
  retention_per_kg numeric(18,4) CHECK (retention_per_kg IS NULL OR retention_per_kg >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  PRIMARY KEY (collector_id, value_chain_id)
);
ALTER TABLE collector_rates ENABLE ROW LEVEL SECURITY; ALTER TABLE collector_rates FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON collector_rates USING (organization_id::text = current_setting('app.current_org', true)) WITH CHECK (organization_id::text = current_setting('app.current_org', true));
SELECT replication_install_triggers();
COMMIT;
