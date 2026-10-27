-- Photo de profil d'un producteur (une seule, la dernière remplace la précédente), conservée chiffrée.
BEGIN;
CREATE TABLE producer_photos (
  producer_id uuid PRIMARY KEY REFERENCES producers(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  mime text NOT NULL CHECK (mime IN ('image/jpeg','image/png')),
  data bytea NOT NULL,
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE producer_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE producer_photos FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON producer_photos USING (organization_id::text = current_setting('app.current_org', true)) WITH CHECK (organization_id::text = current_setting('app.current_org', true));
COMMIT;
