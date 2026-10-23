-- Bulletin de pesée du magasin : double pesée (entrée / sortie), analyse qualité, tare des sacs, réfaction, classement, numéro de bulletin.
-- Tout est facultatif : une réception saisie avec le seul poids total reste valable (le bulletin n'affiche alors que ce qui est connu).
BEGIN;
ALTER TABLE convoy_receptions
  ADD COLUMN bulletin_no text,
  ADD COLUMN trailer_no text,
  ADD COLUMN origin text,
  ADD COLUMN weigh_in_kg numeric(18,3) CHECK (weigh_in_kg IS NULL OR weigh_in_kg > 0),
  ADD COLUMN weigh_in_at timestamptz,
  ADD COLUMN scale_in text,
  ADD COLUMN weigh_out_kg numeric(18,3) CHECK (weigh_out_kg IS NULL OR weigh_out_kg >= 0),
  ADD COLUMN weigh_out_at timestamptz,
  ADD COLUMN scale_out text,
  ADD COLUMN gross_kg numeric(18,3),                 -- poids brut livré = entrée - sortie
  ADD COLUMN bag_tare_kg numeric(18,3) CHECK (bag_tare_kg IS NULL OR bag_tare_kg >= 0),
  ADD COLUMN refaction_kg numeric(18,3) CHECK (refaction_kg IS NULL OR refaction_kg >= 0),
  ADD COLUMN grade text,
  ADD COLUMN bags_unloaded integer CHECK (bags_unloaded IS NULL OR bags_unloaded >= 0),
  ADD COLUMN bags_refused integer CHECK (bags_refused IS NULL OR bags_refused >= 0),
  ADD COLUMN analysis jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE bulletin_counters (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  year int NOT NULL,
  last_no int NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, year)
);
ALTER TABLE bulletin_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulletin_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON bulletin_counters
  USING (organization_id::text = current_setting('app.current_org', true))
  WITH CHECK (organization_id::text = current_setting('app.current_org', true));

-- Numéros des réceptions déjà enregistrées : BP-<année>-<n° à 6 chiffres>, dans l'ordre de réception.
WITH n AS (
  SELECT id, organization_id, extract(year FROM received_at)::int AS y,
         row_number() OVER (PARTITION BY organization_id, extract(year FROM received_at) ORDER BY received_at, id) AS rn
    FROM convoy_receptions)
UPDATE convoy_receptions r SET bulletin_no = 'BP-' || n.y || '-' || lpad(n.rn::text, 6, '0') FROM n WHERE n.id = r.id;
INSERT INTO bulletin_counters(organization_id, year, last_no)
  SELECT organization_id, extract(year FROM received_at)::int, count(*) FROM convoy_receptions GROUP BY 1, 2;
ALTER TABLE convoy_receptions ADD CONSTRAINT convoy_receptions_bulletin_unique UNIQUE (organization_id, bulletin_no);
COMMIT;
