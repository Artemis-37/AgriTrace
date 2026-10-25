-- Photo d'identité facultative des personnes (délégués/utilisateurs et producteurs). Une photo par personne, PNG ou JPEG, 2 Mo maximum.
BEGIN;
CREATE TABLE person_photos (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  subject_type text NOT NULL CHECK (subject_type IN ('user','producer')),
  subject_id uuid NOT NULL,
  mime text NOT NULL CHECK (mime IN ('image/png','image/jpeg')),
  data bytea NOT NULL,
  sha256 text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  PRIMARY KEY (organization_id, subject_type, subject_id)
);
ALTER TABLE person_photos ENABLE ROW LEVEL SECURITY; ALTER TABLE person_photos FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON person_photos USING (organization_id::text = current_setting('app.current_org', true)) WITH CHECK (organization_id::text = current_setting('app.current_org', true));
SELECT replication_install_triggers();
COMMIT;
