BEGIN;
-- 1. Demandes d'annulation : le magasinier, le caissier ou le comptable demande ; un responsable (administrateur de coopérative) approuve ou rejette.
CREATE TABLE cancellation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  entity_type text NOT NULL CHECK (entity_type IN ('convoy_reception','convoy_settlement','financial_transaction','accounting_entry','warehouse_movement')),
  entity_id uuid NOT NULL,
  entity_label text NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 5 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','failed')),
  requested_by uuid NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  decision_note text,
  snapshot jsonb,
  CHECK (status = 'pending' OR decided_by IS NOT NULL)
);
CREATE UNIQUE INDEX uq_cancellation_one_pending ON cancellation_requests (organization_id, entity_type, entity_id) WHERE status = 'pending';
CREATE INDEX idx_cancellation_org ON cancellation_requests (organization_id, status, requested_at DESC);
ALTER TABLE cancellation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE cancellation_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON cancellation_requests
  USING (organization_id::text = current_setting('app.current_org', true))
  WITH CHECK (organization_id::text = current_setting('app.current_org', true));

-- Un règlement de convoi annulé puis refait doit produire de nouvelles écritures (clés d'idempotence distinctes).
ALTER TABLE convoy_receptions ADD COLUMN settle_attempts integer NOT NULL DEFAULT 0;

INSERT INTO permissions(code, description) VALUES
 ('cancellations:request','Demander l''annulation d''une de ses opérations (soumise à approbation)'),
 ('cancellations:decide','Approuver ou rejeter les demandes d''annulation');
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
   WHERE r.code = 'coop_admin' AND p.code IN ('cancellations:request','cancellations:decide') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, 'cancellations:request' FROM roles r WHERE r.code IN ('magasinier','caissier','comptable') ON CONFLICT DO NOTHING;

-- 2. Fiche de la coopérative (CDC §4.1).
CREATE TABLE organization_profile (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id),
  commercial_name text,
  address text,
  phone text,
  email text,
  currency char(3) NOT NULL DEFAULT 'XOF',
  default_language text NOT NULL DEFAULT 'fr' CHECK (default_language IN ('fr','en')),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE organization_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON organization_profile
  USING (organization_id::text = current_setting('app.current_org', true))
  WITH CHECK (organization_id::text = current_setting('app.current_org', true));
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, 'org:branding' FROM roles r WHERE r.code = 'coop_admin' ON CONFLICT DO NOTHING;

-- 3. Mot de passe : changement obligatoire après une réinitialisation par un administrateur.
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
COMMIT;
