-- 018 : association des postes de travail (comme CentriGest) : code à 8 caractères valable 15 min, à usage unique,
--       jeton propre à chaque poste, révocable ; règle « association obligatoire » par coopérative.
BEGIN;

CREATE TABLE workstations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 60),
  function_label text,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz, revoked_by uuid REFERENCES users(id), revoked_reason text
);
CREATE INDEX idx_workstations_org ON workstations(organization_id, status);

-- Codes d'association : seule l'empreinte est conservée. Table de recherche sans RLS (le poste ne connaît pas encore la coopérative).
CREATE TABLE workstation_pairing_codes (
  code_hash text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL, function_label text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz, workstation_id uuid REFERENCES workstations(id)
);

ALTER TABLE workstations ENABLE ROW LEVEL SECURITY;
ALTER TABLE workstations FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON workstations
  USING (organization_id::text = current_setting('app.current_org', true))
  WITH CHECK (organization_id::text = current_setting('app.current_org', true));

ALTER TABLE org_settings ADD COLUMN workstations_required boolean NOT NULL DEFAULT false;

-- Ces tables restent sur le serveur qui les a créées : jamais répliquées vers le central.
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('replication_install_triggers'::regproc);
  d := replace(d, '''message_seen''', '''message_seen'',''workstations'',''workstation_pairing_codes''');
  EXECUTE d;
END $$;

INSERT INTO permissions(code, description) VALUES
 ('workstations:manage','Associer, révoquer les postes de travail et rendre l''association obligatoire');
INSERT INTO role_permissions(role_id, permission_code)
  SELECT id, 'workstations:manage' FROM roles WHERE code = 'coop_admin' ON CONFLICT DO NOTHING;
COMMIT;
