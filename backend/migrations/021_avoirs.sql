-- 021 : avoirs (notes de crédit) sur factures de vente ; réduisent le solde à encaisser, écriture comptable propre, immuables.
BEGIN;
CREATE TABLE credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key text NOT NULL,
  number text NOT NULL,
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  buyer_id uuid NOT NULL REFERENCES buyers(id),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL,
  reason text NOT NULL,
  issued_on date NOT NULL,
  entry_number text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  UNIQUE (organization_id, idempotency_key), UNIQUE (organization_id, number)
);
CREATE INDEX idx_credit_notes_invoice ON credit_notes (invoice_id);
ALTER TABLE credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON credit_notes
  USING (organization_id::text = current_setting('app.current_org', true))
  WITH CHECK (organization_id::text = current_setting('app.current_org', true));
CREATE TRIGGER trg_credit_notes_immutable BEFORE UPDATE OR DELETE ON credit_notes FOR EACH ROW EXECUTE FUNCTION forbid_change();
COMMIT;
