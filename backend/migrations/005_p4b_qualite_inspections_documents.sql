-- AgriTrace P4b : règles qualité configurables, inspections, actions correctives, certificats, documents.
-- AgriTrace facilite la collecte des preuves ; il ne se substitue pas à un organisme officiel de certification.
BEGIN;

CREATE TABLE quality_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  value_chain_id uuid REFERENCES value_chains(id),
  market text,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_]{2,40}$'),
  label text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('numeric','boolean')),
  min_value numeric(18,4), max_value numeric(18,4),
  expected_bool boolean,
  unit text,
  blocking boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  CHECK (kind <> 'numeric' OR (min_value IS NOT NULL OR max_value IS NOT NULL)),
  CHECK (kind <> 'boolean' OR expected_bool IS NOT NULL),
  UNIQUE (organization_id, code)
);

CREATE TABLE inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key text NOT NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('producer','collector','lot','weighing','warehouse')),
  subject_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('field','quality','compliance')),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed','cancelled')),
  scheduled_for date,
  inspector_id uuid,
  started_at timestamptz, completed_at timestamptz,
  outcome text CHECK (outcome IN ('compliant','to_review','non_compliant')),
  summary text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX idx_inspections_subject ON inspections (subject_type, subject_id, completed_at);

-- Résultats : copie du libellé et des seuils appliqués (historique stable même si la règle change ensuite)
CREATE TABLE inspection_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  inspection_id uuid NOT NULL REFERENCES inspections(id),
  rule_id uuid NOT NULL REFERENCES quality_rules(id),
  rule_code text NOT NULL, rule_label text NOT NULL, blocking boolean NOT NULL,
  applied_min numeric(18,4), applied_max numeric(18,4), applied_expected boolean,
  value_num numeric(18,4), value_bool boolean,
  passed boolean NOT NULL,
  note text,
  recorded_at timestamptz NOT NULL DEFAULT now(), recorded_by uuid NOT NULL,
  UNIQUE (inspection_id, rule_id)
);
CREATE TRIGGER trg_inspection_results_immutable BEFORE UPDATE OR DELETE ON inspection_results FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE corrective_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  inspection_id uuid NOT NULL REFERENCES inspections(id),
  description text NOT NULL,
  responsible_id uuid,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  closed_at timestamptz, closed_by uuid, closure_note text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  subject_type text NOT NULL CHECK (subject_type IN ('producer','collector','declaration','lot','receipt','payment','inspection','certificate','loan')),
  subject_id uuid NOT NULL,
  kind text NOT NULL,
  filename text NOT NULL,
  mime text NOT NULL CHECK (mime IN ('application/pdf','image/jpeg','image/png')),
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  sha256 text NOT NULL,
  storage_key uuid NOT NULL DEFAULT gen_random_uuid(),   -- clé aléatoire : aucune URL prévisible
  version integer NOT NULL DEFAULT 1,
  replaces_id uuid REFERENCES documents(id),
  sensitive boolean NOT NULL DEFAULT false,
  retention_until date,
  uploaded_at timestamptz NOT NULL DEFAULT now(), uploaded_by uuid NOT NULL,
  UNIQUE (storage_key)
);
CREATE UNIQUE INDEX uq_documents_one_successor ON documents (replaces_id) WHERE replaces_id IS NOT NULL;
CREATE INDEX idx_documents_subject ON documents (subject_type, subject_id);
CREATE TRIGGER trg_documents_immutable BEFORE UPDATE OR DELETE ON documents FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE document_downloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  document_id uuid NOT NULL REFERENCES documents(id),
  user_id uuid NOT NULL, at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_document_downloads_immutable BEFORE UPDATE OR DELETE ON document_downloads FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  holder_type text NOT NULL CHECK (holder_type IN ('organization','producer','warehouse','lot')),
  holder_id uuid,
  scheme text NOT NULL,
  number text NOT NULL,
  issuer text NOT NULL,
  issued_on date NOT NULL, expires_on date NOT NULL,
  document_id uuid REFERENCES documents(id),
  revoked_at timestamptz, revoked_reason text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  CHECK (expires_on > issued_on),
  UNIQUE (organization_id, scheme, number)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['quality_rules','inspections','inspection_results','corrective_actions','documents','document_downloads','certificates']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I
      USING (organization_id::text = current_setting('app.current_org', true))
      WITH CHECK (organization_id::text = current_setting('app.current_org', true))$p$, t);
  END LOOP;
END $$;

INSERT INTO permissions(code, description) VALUES
 ('quality:read','Consulter les règles qualité'),
 ('quality:manage','Configurer les règles qualité'),
 ('inspections:read','Consulter les inspections'),
 ('inspections:perform','Planifier, réaliser et clôturer des inspections et actions correctives'),
 ('certificates:read','Consulter les certificats'),
 ('certificates:manage','Enregistrer et révoquer des certificats'),
 ('documents:read','Consulter et télécharger les documents'),
 ('documents:upload','Déposer des documents'),
 ('documents:sensitive','Télécharger les documents sensibles'),
 ('alerts:read','Consulter les alertes et échéances');

INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, p.code FROM roles r CROSS JOIN permissions p WHERE r.code = 'coop_admin'
  ON CONFLICT DO NOTHING;

COMMIT;
