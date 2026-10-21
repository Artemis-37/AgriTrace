BEGIN;
-- Logo propre à chaque coopérative (PNG ou JPEG, 1 Mo maximum), affiché dans son portail et dans l'application mobile.
CREATE TABLE organization_logos (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id),
  mime text NOT NULL CHECK (mime IN ('image/png','image/jpeg')),
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 1048576),
  sha256 text NOT NULL,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE organization_logos ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_logos FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON organization_logos
  USING (organization_id::text = current_setting('app.current_org', true))
  WITH CHECK (organization_id::text = current_setting('app.current_org', true));

INSERT INTO permissions(code, description) VALUES ('org:branding','Modifier l''identité visuelle de la coopérative (logo)');
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, 'org:branding' FROM roles r WHERE r.code = 'coop_admin' ON CONFLICT DO NOTHING;
COMMIT;
