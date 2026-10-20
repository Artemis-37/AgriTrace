-- 020 : préfinancement relié aux comptes financiers et à la comptabilité ; netting avances (409) / dettes (401) à chaque livraison.
BEGIN;
ALTER TABLE prefinancings
  ADD COLUMN account_id uuid REFERENCES financial_accounts(id),
  ADD COLUMN receipt_tx_id uuid REFERENCES financial_transactions(id),
  ADD COLUMN receipt_entry_number text;
ALTER TABLE prefinancing_uses
  ADD COLUMN tx_id uuid REFERENCES financial_transactions(id),
  ADD COLUMN entry_number text;
ALTER TABLE prefinancing_repayments
  ADD COLUMN tx_id uuid REFERENCES financial_transactions(id),
  ADD COLUMN entry_number text;

-- Netting à la livraison : part du net à payer compensée par les financements (409) déjà remis au collecteur.
ALTER TABLE convoy_receptions
  ADD COLUMN advance_netted numeric(18,4) NOT NULL DEFAULT 0 CHECK (advance_netted >= 0),
  ADD COLUMN netting_entry_number text;
COMMIT;
