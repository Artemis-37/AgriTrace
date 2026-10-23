-- Fiche du délégué (comme la fiche membre de l'ancien logiciel) : coordonnées bancaires et pièce d'identité.
BEGIN;
ALTER TABLE collectors
  ADD COLUMN bank_name text CHECK (bank_name IS NULL OR length(bank_name) BETWEEN 1 AND 80),
  ADD COLUMN bank_account text CHECK (bank_account IS NULL OR length(bank_account) BETWEEN 1 AND 40),
  ADD COLUMN id_doc_type text CHECK (id_doc_type IS NULL OR id_doc_type IN ('cni','passeport','attestation','permis','autre')),
  ADD COLUMN id_doc_no text CHECK (id_doc_no IS NULL OR length(id_doc_no) BETWEEN 1 AND 40);
COMMIT;
