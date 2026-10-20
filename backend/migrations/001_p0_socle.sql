-- AgriTrace P0 — socle : organisations, accès, sessions, appareils, audit
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  country_code char(2) NOT NULL DEFAULT 'CI',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  full_name text NOT NULL,
  phone text,
  password_hash text NOT NULL,
  is_platform_admin boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  failed_logins integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE permissions (
  code text PRIMARY KEY,           -- ex. producers:read
  description text NOT NULL
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE, -- NULL = rôle modèle de plateforme
  code text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (organization_id, code)
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  requires_second_approval boolean NOT NULL DEFAULT false,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE user_organizations (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (user_id, organization_id, role_id)
);
CREATE INDEX idx_user_orgs_org ON user_organizations(organization_id);

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text,
  platform text NOT NULL DEFAULT 'android',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  refresh_token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip inet,
  user_agent text
);
CREATE INDEX idx_sessions_user ON user_sessions(user_id);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id),
  actor_user_id uuid,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_org_date ON audit_logs(organization_id, created_at DESC);

-- Journal d'audit en insertion seule
CREATE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs est en insertion seule';
END $$;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
CREATE TRIGGER trg_audit_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();

-- Isolation par organisation (RLS) : l'application pose app.current_org par transaction
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_org_isolation ON audit_logs
  USING (organization_id IS NULL OR organization_id::text = current_setting('app.current_org', true))
  WITH CHECK (organization_id IS NULL OR organization_id::text = current_setting('app.current_org', true));

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_org_isolation ON roles
  USING (organization_id IS NULL OR organization_id::text = current_setting('app.current_org', true))
  WITH CHECK (organization_id::text = current_setting('app.current_org', true) OR current_setting('app.current_org', true) = '*');

-- Permissions de base (P0)
INSERT INTO permissions(code, description) VALUES
 ('organizations:read','Consulter les organisations'),
 ('organizations:manage','Gérer les organisations'),
 ('users:read','Consulter les utilisateurs'),
 ('users:create','Créer des utilisateurs'),
 ('users:manage','Gérer les utilisateurs et rôles'),
 ('roles:manage','Gérer les rôles et permissions'),
 ('audit:read','Consulter les journaux d''audit'),
 ('settings:manage','Gérer les paramètres'),
 ('producers:read','Consulter les producteurs'),
 ('producers:create','Créer des producteurs'),
 ('producers:export','Exporter les producteurs');

COMMIT;
