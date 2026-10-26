-- Inspection interne : nouvelle nature d'élément ajouté au profil du producteur, et logos des certifications
-- (téléversés par la coopérative : le logiciel n'embarque aucun logo de tiers) utilisés à l'export des fiches.
BEGIN;
ALTER TABLE producer_assignments DROP CONSTRAINT IF EXISTS producer_assignments_kind_check;
ALTER TABLE producer_assignments ADD CONSTRAINT producer_assignments_kind_check CHECK (kind IN ('formation','distribution','tache','inspection'));

CREATE TABLE certification_logos (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  scheme text NOT NULL CHECK (scheme IN ('rainforest_alliance','fairtrade','fairtrade_usa')),
  mime text NOT NULL CHECK (mime IN ('image/png','image/jpeg')),
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 1048576),
  sha256 text NOT NULL,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, scheme)
);
ALTER TABLE certification_logos ENABLE ROW LEVEL SECURITY;
ALTER TABLE certification_logos FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON certification_logos
  USING (organization_id::text = current_setting('app.current_org', true))
  WITH CHECK (organization_id::text = current_setting('app.current_org', true));
COMMIT;
