-- AgriTrace : module parcelles (cahier des charges §7). Données déclarées / contrôlées / vérifiées distinguées.
BEGIN;

CREATE TABLE parcels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  code text NOT NULL,
  idempotency_key text NOT NULL,
  producer_id uuid NOT NULL REFERENCES producers(id),
  value_chain_id uuid NOT NULL REFERENCES value_chains(id),
  declared_area_ha numeric(12,4) NOT NULL CHECK (declared_area_ha > 0),
  latitude numeric(9,6) CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) CHECK (longitude BETWEEN -180 AND 180),
  geometry jsonb,                         -- GeoJSON Polygon (WGS84) si disponible
  geometry_area_ha numeric(12,4),         -- calculée par le serveur depuis la géométrie
  registered_on date NOT NULL DEFAULT current_date,
  verification_status text NOT NULL DEFAULT 'declared' CHECK (verification_status IN ('declared','controlled','verified')),
  controlled_at timestamptz, controlled_by uuid,
  verified_at timestamptz, verified_by uuid, verified_inspection_id uuid REFERENCES inspections(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX idx_parcels_producer ON parcels (producer_id);

CREATE TABLE parcel_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  parcel_id uuid NOT NULL REFERENCES parcels(id),
  seq bigserial NOT NULL,                 -- ordre strict des événements, même au sein d'une transaction
  event text NOT NULL CHECK (event IN ('created','updated','controlled','verified','reset','archived')),
  from_status text, to_status text, details jsonb,
  actor_id uuid NOT NULL, at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_parcel_history_immutable BEFORE UPDATE OR DELETE ON parcel_history FOR EACH ROW EXECUTE FUNCTION forbid_change();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['parcels','parcel_history']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I
      USING (organization_id::text = current_setting('app.current_org', true))
      WITH CHECK (organization_id::text = current_setting('app.current_org', true))$p$, t);
  END LOOP;
END $$;

-- Les inspections et les documents peuvent désormais cibler une parcelle
ALTER TABLE inspections DROP CONSTRAINT inspections_subject_type_check;
ALTER TABLE inspections ADD CONSTRAINT inspections_subject_type_check
  CHECK (subject_type IN ('producer','collector','lot','weighing','warehouse','parcel'));
ALTER TABLE documents DROP CONSTRAINT documents_subject_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_subject_type_check
  CHECK (subject_type IN ('producer','collector','declaration','lot','receipt','payment','inspection','certificate','loan','parcel'));

INSERT INTO permissions(code, description) VALUES
 ('parcels:read','Consulter les parcelles'),
 ('parcels:create','Enregistrer des parcelles'),
 ('parcels:update','Modifier une parcelle (repasse en « déclarée »)'),
 ('parcels:control','Contrôler les données d''une parcelle'),
 ('parcels:verify','Vérifier une parcelle (inspection conforme exigée)');
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, p.code FROM roles r CROSS JOIN permissions p WHERE r.code = 'coop_admin'
  ON CONFLICT DO NOTHING;

COMMIT;
