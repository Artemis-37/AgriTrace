-- Écart de poids bloquant : au-delà de la tolérance, la réception attend la validation d'un second utilisateur avant la caisse.
ALTER TABLE org_settings ADD COLUMN convoy_weight_tolerance_pct numeric(6,3) NOT NULL DEFAULT 2 CHECK (convoy_weight_tolerance_pct >= 0);
ALTER TABLE convoy_receptions DROP CONSTRAINT convoy_receptions_status_check;
ALTER TABLE convoy_receptions DROP CONSTRAINT convoy_receptions_check;
ALTER TABLE convoy_receptions ADD CONSTRAINT convoy_receptions_status_check CHECK (status IN ('pending_variance','pending_cashier','settled'));
ALTER TABLE convoy_receptions ADD CONSTRAINT convoy_receptions_settled_check CHECK (status <> 'settled' OR (tx_id IS NOT NULL AND amount IS NOT NULL));
ALTER TABLE convoy_receptions
  ADD COLUMN variance_pct numeric(8,3),
  ADD COLUMN variance_approved_by uuid,
  ADD COLUMN variance_approved_at timestamptz,
  ADD COLUMN variance_comment text;
