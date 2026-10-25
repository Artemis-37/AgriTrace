-- Financement remis à un délégué : mode de paiement (espèces ou chèque), n° de chèque, n° de bordereau et motif codé (compris par le logiciel).
BEGIN;
ALTER TABLE collector_advances
  ADD COLUMN payment_mode text NOT NULL DEFAULT 'cash' CHECK (payment_mode IN ('cash','cheque')),
  ADD COLUMN cheque_no text,
  ADD COLUMN slip_no text,
  ADD COLUMN motive text;
COMMIT;
