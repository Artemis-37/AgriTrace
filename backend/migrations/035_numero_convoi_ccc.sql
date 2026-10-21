-- Numéro de connaissement des convois généré par le logiciel : <code CCC>-<année>-<3 lettres du collecteur>-<n°>
-- Exemple : SC000000-2026-OUM-1 = 1er convoi de 2026 d'un collecteur dont le nom commence par OUM.
BEGIN;
ALTER TABLE organization_profile ADD COLUMN ccc_code text CHECK (ccc_code IS NULL OR ccc_code ~ '^[A-Z0-9]{3,20}$');

-- Compteur par coopérative, année et préfixe de 3 lettres (deux collecteurs au même préfixe ne peuvent donc jamais produire le même numéro).
CREATE TABLE convoy_number_counters (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  year int NOT NULL,
  prefix text NOT NULL CHECK (prefix ~ '^[A-Z]{3}$'),
  last_no int NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, year, prefix)
);
ALTER TABLE convoy_number_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE convoy_number_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON convoy_number_counters
  USING (organization_id::text = current_setting('app.current_org', true))
  WITH CHECK (organization_id::text = current_setting('app.current_org', true));
COMMIT;
