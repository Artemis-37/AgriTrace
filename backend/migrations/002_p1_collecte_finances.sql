-- AgriTrace P1 — référentiels, collecte, prix, déclarations, finances de base
BEGIN;

CREATE TABLE value_chains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  code text NOT NULL,
  name text NOT NULL,
  default_unit text NOT NULL DEFAULT 'kg',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, code)
);

CREATE TABLE unit_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  value_chain_id uuid NOT NULL REFERENCES value_chains(id),
  from_unit text NOT NULL,
  to_unit text NOT NULL,
  factor numeric(18,6) NOT NULL CHECK (factor > 0),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  UNIQUE (organization_id, value_chain_id, from_unit, to_unit)
);

CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  value_chain_id uuid NOT NULL REFERENCES value_chains(id),
  code text NOT NULL,
  name text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('planned','open','closed')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, code),
  CHECK (ends_on >= starts_on)
);

CREATE TABLE producers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  internal_code text NOT NULL,
  last_name text NOT NULL,
  first_names text NOT NULL,
  phone text,
  region text, department text, section text, village text,
  joined_on date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','left')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, internal_code)
);
CREATE INDEX idx_producers_search ON producers (organization_id, lower(last_name), lower(first_names));
CREATE INDEX idx_producers_phone ON producers (organization_id, phone);

CREATE TABLE producer_value_chains (
  producer_id uuid NOT NULL REFERENCES producers(id) ON DELETE CASCADE,
  value_chain_id uuid NOT NULL REFERENCES value_chains(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  PRIMARY KEY (producer_id, value_chain_id)
);

CREATE TABLE collectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, user_id)
);

CREATE TABLE collector_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  collector_id uuid NOT NULL REFERENCES collectors(id) ON DELETE CASCADE,
  value_chain_id uuid REFERENCES value_chains(id),
  zone text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid
);

CREATE TABLE price_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  value_chain_id uuid NOT NULL REFERENCES value_chains(id),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  unit text NOT NULL,
  currency char(3) NOT NULL DEFAULT 'XOF',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  UNIQUE (organization_id, value_chain_id, campaign_id, unit)
);

-- Versions de barème : immuables. Un nouveau prix = une nouvelle version.
CREATE TABLE price_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  schedule_id uuid NOT NULL REFERENCES price_schedules(id),
  version_no integer NOT NULL,
  unit_price numeric(18,4) NOT NULL CHECK (unit_price >= 0),
  valid_from date NOT NULL,
  valid_to date,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  UNIQUE (schedule_id, version_no),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% est immuable (table %)', TG_OP, TG_TABLE_NAME;
END $$;
CREATE TRIGGER trg_price_versions_immutable BEFORE UPDATE OR DELETE ON price_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE purchase_declarations (
  id uuid PRIMARY KEY,                       -- identifiant local stable généré par le client
  organization_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key text NOT NULL,
  collector_id uuid NOT NULL REFERENCES collectors(id),
  producer_id uuid NOT NULL REFERENCES producers(id),
  value_chain_id uuid NOT NULL REFERENCES value_chains(id),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  operation_date date NOT NULL,
  bags integer CHECK (bags IS NULL OR bags >= 0),
  quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  price_version_id uuid REFERENCES price_versions(id),
  unit_price numeric(18,4),
  currency char(3),
  amount numeric(18,4),
  notes text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN
    ('draft','received','in_review','to_correct','accepted','partially_received','received_confirmed','rejected','cancelled')),
  status_reason text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX idx_decl_org_status ON purchase_declarations (organization_id, status, operation_date);

CREATE TABLE purchase_declaration_history (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  declaration_id uuid NOT NULL REFERENCES purchase_declarations(id),
  from_status text, to_status text NOT NULL,
  reason text, actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE financial_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  owner_type text NOT NULL CHECK (owner_type IN ('producer','collector','cash_register','other')),
  owner_id uuid,
  name text NOT NULL,
  currency char(3) NOT NULL DEFAULT 'XOF',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid
);

CREATE TABLE cash_registers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  currency char(3) NOT NULL DEFAULT 'XOF',
  account_id uuid REFERENCES financial_accounts(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  UNIQUE (organization_id, name)
);

CREATE TABLE cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  register_id uuid NOT NULL REFERENCES cash_registers(id),
  opened_by uuid NOT NULL, opened_at timestamptz NOT NULL DEFAULT now(),
  opening_amount numeric(18,4) NOT NULL CHECK (opening_amount >= 0),
  closed_by uuid, closed_at timestamptz,
  counted_amount numeric(18,4), expected_amount numeric(18,4), variance numeric(18,4),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed'))
);
-- Une seule session ouverte par caisse : les caisses sont indépendantes
CREATE UNIQUE INDEX uq_one_open_session ON cash_sessions (register_id) WHERE status = 'open';

CREATE TABLE financial_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key text NOT NULL,
  account_id uuid NOT NULL REFERENCES financial_accounts(id),
  cash_session_id uuid REFERENCES cash_sessions(id),
  direction text NOT NULL CHECK (direction IN ('in','out')),
  amount numeric(18,4) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL,
  reason text NOT NULL,
  reference_type text, reference_id uuid,
  reversal_of uuid REFERENCES financial_transactions(id),
  status text NOT NULL DEFAULT 'validated' CHECK (status IN ('validated')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX idx_fintx_account ON financial_transactions (account_id, created_at);
-- Une opération validée ne se modifie ni ne se supprime : correction par écriture compensatoire
CREATE TRIGGER trg_fintx_immutable BEFORE UPDATE OR DELETE ON financial_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE UNIQUE INDEX uq_fintx_one_reversal ON financial_transactions (reversal_of) WHERE reversal_of IS NOT NULL;

-- RLS sur toutes les tables à organization_id
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['value_chains','unit_conversions','campaigns','producers','producer_value_chains',
    'collectors','collector_assignments','price_schedules','price_versions','purchase_declarations',
    'purchase_declaration_history','financial_accounts','cash_registers','cash_sessions','financial_transactions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I
      USING (organization_id::text = current_setting('app.current_org', true))
      WITH CHECK (organization_id::text = current_setting('app.current_org', true))$p$, t);
  END LOOP;
END $$;

INSERT INTO permissions(code, description) VALUES
 ('producers:update','Modifier des producteurs'),
 ('producers:import','Importer des producteurs depuis Excel'),
 ('value_chains:read','Consulter les filières'),
 ('value_chains:manage','Gérer les filières et conversions'),
 ('campaigns:read','Consulter les campagnes'),
 ('campaigns:manage','Gérer les campagnes'),
 ('prices:read','Consulter les prix'),
 ('prices:manage','Gérer les barèmes de prix'),
 ('collectors:read','Consulter les collecteurs'),
 ('collectors:manage','Gérer les collecteurs et affectations'),
 ('declarations:read','Consulter les déclarations d''achat'),
 ('declarations:create','Créer et soumettre des déclarations'),
 ('declarations:validate','Vérifier, accepter ou rejeter des déclarations'),
 ('cash:read','Consulter les caisses'),
 ('cash:manage','Créer des caisses et comptes'),
 ('cash:operate','Ouvrir, clôturer et enregistrer des opérations de caisse'),
 ('finance:read','Consulter les comptes et transactions'),
 ('finance:reverse','Passer une écriture compensatoire');

-- Les rôles administrateur déjà créés reçoivent les nouvelles permissions
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
  WHERE r.code = 'coop_admin'
  ON CONFLICT DO NOTHING;

COMMIT;
