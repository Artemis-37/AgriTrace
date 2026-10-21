-- Interface de terrain : fiche producteur enrichie, infrastructures sociales, formations, distributions.
BEGIN;

ALTER TABLE producers
  ADD COLUMN gender text CHECK (gender IN ('male','female')),
  ADD COLUMN birth_date date,
  ADD COLUMN id_doc_type text,
  ADD COLUMN id_doc_number text,
  ADD COLUMN consent_at timestamptz;

-- Enregistrements de terrain créés hors connexion (identifiant fourni par l'appareil, idempotents).
CREATE TABLE field_records (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('social_infrastructure','training','distribution')),
  title text NOT NULL,
  latitude numeric(10,7),
  longitude numeric(10,7),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX idx_field_records_kind ON field_records(organization_id, kind, created_at DESC);

-- Catalogue des articles et services distribuables (catégorie → groupe → article).
CREATE TABLE distribution_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  category text NOT NULL,
  group_name text NOT NULL,
  name text NOT NULL,
  unit text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, category, group_name, name)
);

-- Pièces jointes (photo de formation, signature) rattachées à un enregistrement de terrain.
ALTER TABLE documents DROP CONSTRAINT documents_subject_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_subject_type_check CHECK (subject_type IN
  ('producer','collector','declaration','lot','receipt','payment','inspection','certificate','loan','parcel','task','shipment','order','invoice','claim','weighing','field_record'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['field_records','distribution_articles'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I
      USING (organization_id::text = current_setting('app.current_org', true))
      WITH CHECK (organization_id::text = current_setting('app.current_org', true))$p$, t);
  END LOOP;
END $$;

INSERT INTO permissions(code, description) VALUES
 ('field_records:create','Enregistrer sur le terrain : infrastructures sociales, formations, distributions'),
 ('field_records:read','Consulter les enregistrements de terrain'),
 ('field_records:manage','Gérer le catalogue des articles et services distribuables');
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, p.code FROM roles r CROSS JOIN permissions p WHERE r.code = 'coop_admin' AND p.code LIKE 'field_records:%' ON CONFLICT DO NOTHING;
COMMIT;
