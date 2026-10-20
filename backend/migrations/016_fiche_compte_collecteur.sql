-- 016 : fiche de suivi du compte collecteur (produit, transport, retenue, net à payer, financements, solde).
BEGIN;
ALTER TABLE org_settings
  ADD COLUMN convoy_transport_unit numeric(18,4) NOT NULL DEFAULT 0 CHECK (convoy_transport_unit >= 0),
  ADD COLUMN convoy_retention_per_kg numeric(18,4) NOT NULL DEFAULT 0 CHECK (convoy_retention_per_kg >= 0);

ALTER TABLE convoy_receptions
  ADD COLUMN gross_amount numeric(18,4),
  ADD COLUMN transport_unit numeric(18,4),
  ADD COLUMN transport_total numeric(18,4),
  ADD COLUMN retention_per_kg numeric(18,4),
  ADD COLUMN retention_amount numeric(18,4);

-- Financements remis au collecteur (« Finance cacao »), reports de solde de campagne ; l'écriture financière est dans financial_transactions.
CREATE TABLE collector_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key text NOT NULL,
  collector_id uuid NOT NULL REFERENCES collectors(id),
  kind text NOT NULL CHECK (kind IN ('advance','carry_forward')),
  piece_no text,
  label text NOT NULL,
  amount numeric(18,4) NOT NULL CHECK (amount > 0),
  tx_id uuid NOT NULL REFERENCES financial_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  UNIQUE (organization_id, idempotency_key)
);
ALTER TABLE collector_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE collector_advances FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON collector_advances
  USING (organization_id::text = current_setting('app.current_org', true))
  WITH CHECK (organization_id::text = current_setting('app.current_org', true));
CREATE TRIGGER trg_collector_advances_immutable BEFORE UPDATE OR DELETE ON collector_advances FOR EACH ROW EXECUTE FUNCTION forbid_change();
COMMIT;
