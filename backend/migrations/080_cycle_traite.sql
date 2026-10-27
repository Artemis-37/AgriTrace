-- Cycle de vie d'une traite : clôture automatique à la date de fin, ouverture à la date de début, bilan de clôture conservé.
BEGIN;
ALTER TABLE campaigns ADD COLUMN closed_at timestamptz, ADD COLUMN closing_summary jsonb;
COMMIT;
