-- Comptes bancaires : banque et n° de compte ; le solde initial est une entrée tracée du compte (« Solde initial »).
ALTER TABLE financial_accounts ADD COLUMN bank_name text, ADD COLUMN account_number text;
