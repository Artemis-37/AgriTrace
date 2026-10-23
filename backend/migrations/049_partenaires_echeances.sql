-- Partenaires/fournisseurs/clients, échéances (factures fournisseurs, emprunts, prestations, ventes d'autres produits, impôts)
-- et produit déclaré par le délégué sur le convoi.
BEGIN;
ALTER TABLE convoys ADD COLUMN product_id uuid REFERENCES products(id);

CREATE TABLE partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  kind text NOT NULL CHECK (kind IN ('supplier','partner','client','lender')),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  phone text CHECK (phone IS NULL OR length(phone) <= 30),
  email text CHECK (email IS NULL OR length(email) <= 120),
  address text CHECK (address IS NULL OR length(address) <= 200),
  tax_id text CHECK (tax_id IS NULL OR length(tax_id) <= 40),
  notes text CHECK (notes IS NULL OR length(notes) <= 500),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid
);
CREATE UNIQUE INDEX uq_partners_name ON partners (organization_id, kind, lower(name));

-- Une échéance : somme à payer (payable) ou à encaisser (receivable) auprès d'un tiers.
CREATE TABLE dues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  kind text NOT NULL CHECK (kind IN ('supplier_invoice','borrowing','service','other_sale','tax')),
  direction text NOT NULL CHECK (direction IN ('payable','receivable')),
  partner_id uuid REFERENCES partners(id),
  ref_no text CHECK (ref_no IS NULL OR length(ref_no) <= 40),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  due_date date NOT NULL,
  issued_on date NOT NULL DEFAULT current_date,
  quantity numeric(14,3) CHECK (quantity IS NULL OR quantity > 0),
  unit_price numeric(14,2) CHECK (unit_price IS NULL OR unit_price >= 0),
  principal numeric(16,2) CHECK (principal IS NULL OR principal > 0),
  rate_pct numeric(6,3) CHECK (rate_pct IS NULL OR rate_pct >= 0),
  term_months int CHECK (term_months IS NULL OR term_months BETWEEN 1 AND 600),
  tax_type text CHECK (tax_type IS NULL OR length(tax_type) <= 40),
  period text CHECK (period IS NULL OR length(period) <= 20),
  amount numeric(16,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','cancelled')),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CHECK ((kind IN ('service','other_sale') AND direction = 'receivable') OR (kind IN ('supplier_invoice','borrowing','tax') AND direction = 'payable'))
);
CREATE UNIQUE INDEX uq_dues_key ON dues (organization_id, idempotency_key);
CREATE INDEX ix_dues_kind ON dues (organization_id, kind, due_date);
CREATE TABLE due_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  due_id uuid NOT NULL REFERENCES dues(id),
  tx_id uuid REFERENCES financial_transactions(id),
  amount numeric(16,2) NOT NULL CHECK (amount > 0),
  paid_on date NOT NULL DEFAULT current_date,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  UNIQUE (organization_id, idempotency_key)
);
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE dues ENABLE ROW LEVEL SECURITY;
ALTER TABLE due_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON partners USING (organization_id::text = current_setting('app.current_org', true)) WITH CHECK (organization_id::text = current_setting('app.current_org', true));
CREATE POLICY org_isolation ON dues USING (organization_id::text = current_setting('app.current_org', true)) WITH CHECK (organization_id::text = current_setting('app.current_org', true));
CREATE POLICY org_isolation ON due_payments USING (organization_id::text = current_setting('app.current_org', true)) WITH CHECK (organization_id::text = current_setting('app.current_org', true));

INSERT INTO permissions(code, description) VALUES
 ('partners:read','Consulter les partenaires, fournisseurs et clients'),
 ('partners:manage','Gérer les partenaires, fournisseurs et clients'),
 ('dues:read','Consulter les échéances (fournisseurs, emprunts, prestations, ventes, impôts)'),
 ('dues:manage','Enregistrer et annuler les échéances'),
 ('dues:settle','Régler ou encaisser une échéance');
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, p FROM roles r, unnest(ARRAY['partners:read','dues:read']) p WHERE r.code IN ('coop_admin','adg','caissier','comptable','direction','responsable_financier') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, p FROM roles r, unnest(ARRAY['partners:manage','dues:manage','dues:settle']) p WHERE r.code IN ('coop_admin','adg','comptable','responsable_financier') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, 'dues:settle' FROM roles r WHERE r.code IN ('caissier','direction') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, 'loans:read' FROM roles r WHERE r.code IN ('comptable') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, 'prefinancing:read' FROM roles r WHERE r.code IN ('comptable') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, 'products:read' FROM roles r WHERE r.code IN ('collecteur') ON CONFLICT DO NOTHING;
COMMIT;
