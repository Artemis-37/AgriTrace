-- Cartographie avancée (CDC v1.0 §8-10, §31) : index spatial, anomalies (doublons / chevauchements),
-- remplacement contrôlé de doublons, imports en masse avec simulation et rapport.
-- Pas de PostGIS dans cet environnement : emprise (bbox) indexée par GiST sur le type natif « box »,
-- puis calcul exact de l'intersection côté serveur (voir docs/CARTOGRAPHIE.md).
BEGIN;

ALTER TABLE parcels
  ADD COLUMN bbox box,
  ADD COLUMN geometry_hash text,
  ADD COLUMN external_id text,
  ADD COLUMN merged_into uuid REFERENCES parcels(id),
  ADD COLUMN gps_accuracy_m numeric(8,2),
  ADD COLUMN surveyed_on date;

-- Emprise calculée par la base à chaque changement de géométrie
CREATE FUNCTION parcels_set_bbox() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE minx float8; miny float8; maxx float8; maxy float8;
BEGIN
  IF NEW.geometry IS NULL THEN NEW.bbox := NULL; RETURN NEW; END IF;
  SELECT min((c->>0)::float8), min((c->>1)::float8), max((c->>0)::float8), max((c->>1)::float8)
    INTO minx, miny, maxx, maxy FROM jsonb_path_query(NEW.geometry, '$.coordinates[*][*]') c;
  NEW.bbox := box(point(maxx, maxy), point(minx, miny));
  RETURN NEW;
END $$;
CREATE TRIGGER trg_parcels_bbox BEFORE INSERT OR UPDATE OF geometry ON parcels FOR EACH ROW EXECUTE FUNCTION parcels_set_bbox();
UPDATE parcels SET geometry = geometry WHERE geometry IS NOT NULL;
CREATE INDEX idx_parcels_bbox ON parcels USING gist (bbox);
CREATE UNIQUE INDEX uq_parcels_external ON parcels (organization_id, external_id) WHERE external_id IS NOT NULL;
-- Une même géométrie normalisée ne peut exister deux fois pour un producteur parmi les parcelles actives (réimportation sans doublon)
CREATE UNIQUE INDEX uq_parcels_geom_producer ON parcels (organization_id, producer_id, geometry_hash) WHERE geometry_hash IS NOT NULL AND status = 'active';

ALTER TABLE parcel_history DROP CONSTRAINT IF EXISTS parcel_history_event_check;
ALTER TABLE parcel_history ADD CONSTRAINT parcel_history_event_check
  CHECK (event IN ('created','updated','controlled','verified','reset','archived','merged','anomaly'));

-- Paramètres géométriques par coopérative (tolérances validées lors du pilote, CDC §10.4)
ALTER TABLE org_settings
  ADD COLUMN geo_overlap_min_m2 numeric(12,2) NOT NULL DEFAULT 25 CHECK (geo_overlap_min_m2 >= 0),
  ADD COLUMN geo_overlap_min_pct numeric(6,3) NOT NULL DEFAULT 1 CHECK (geo_overlap_min_pct BETWEEN 0 AND 100),
  ADD COLUMN geo_near_duplicate_iou numeric(6,4) NOT NULL DEFAULT 0.95 CHECK (geo_near_duplicate_iou BETWEEN 0.5 AND 1),
  ADD COLUMN geo_overlap_policy text NOT NULL DEFAULT 'block' CHECK (geo_overlap_policy IN ('block','warn'));

CREATE TABLE parcel_anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  kind text NOT NULL CHECK (kind IN ('duplicate_identical','duplicate_equivalent','duplicate_near','overlap_partial','overlap_inclusion','invalid_geometry')),
  parcel_a uuid NOT NULL REFERENCES parcels(id),
  parcel_b uuid REFERENCES parcels(id),
  intersection_m2 numeric(14,2), pct_a numeric(7,3), pct_b numeric(7,3), iou numeric(7,5),
  blocking boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','exception','dismissed')),
  recommended_action text,
  detected_at timestamptz NOT NULL DEFAULT now(), detected_by uuid,
  source text NOT NULL DEFAULT 'edit' CHECK (source IN ('edit','import','periodic')),
  assigned_to uuid,
  resolved_at timestamptz, resolved_by uuid, resolution_note text
);
-- Une anomalie ouverte par couple et par type (pas de répétition à chaque contrôle périodique)
CREATE UNIQUE INDEX uq_anomaly_open ON parcel_anomalies (organization_id, kind, parcel_a, coalesce(parcel_b, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE status = 'open';
CREATE INDEX idx_anomaly_a ON parcel_anomalies (parcel_a) WHERE status = 'open';
CREATE INDEX idx_anomaly_b ON parcel_anomalies (parcel_b) WHERE status = 'open';

CREATE TABLE parcel_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  kept_id uuid NOT NULL REFERENCES parcels(id),
  replaced_id uuid NOT NULL UNIQUE REFERENCES parcels(id),
  reason text NOT NULL,
  carried_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  snapshot_replaced jsonb NOT NULL,
  actor_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_parcel_merges_immutable BEFORE UPDATE OR DELETE ON parcel_merges FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE geo_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  file_name text NOT NULL, format text NOT NULL, file_sha256 text NOT NULL, file_size integer NOT NULL,
  mode text NOT NULL CHECK (mode IN ('create_only','create_update','simulate','quarantine')),
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','simulated','completed','failed','cancelled')),
  progress integer NOT NULL DEFAULT 0, total integer NOT NULL DEFAULT 0,
  report jsonb, error text,
  parent_import_id uuid REFERENCES geo_imports(id),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL, finished_at timestamptz
);
CREATE TABLE geo_import_items (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  import_id uuid NOT NULL REFERENCES geo_imports(id),
  row_no integer NOT NULL,
  producer_code text, parcel_code text,
  outcome text NOT NULL CHECK (outcome IN ('create','update','unchanged','rejected','quarantined')),
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  geometry jsonb,
  parcel_id uuid REFERENCES parcels(id)
);
CREATE INDEX idx_geo_items_import ON geo_import_items (import_id, row_no);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['parcel_anomalies','parcel_merges','geo_imports','geo_import_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I
      USING (organization_id::text = current_setting('app.current_org', true))
      WITH CHECK (organization_id::text = current_setting('app.current_org', true))$p$, t);
  END LOOP;
END $$;

INSERT INTO permissions(code, description) VALUES
 ('geo:import','Importer des parcelles depuis un fichier cartographique'),
 ('geo:export','Exporter des parcelles (GeoJSON, KML, KMZ, Shapefile, GeoPackage)'),
 ('geo:export_names','Inclure le nom des producteurs dans les exports cartographiques'),
 ('geo:anomalies','Consulter et traiter les anomalies cartographiques'),
 ('geo:override','Accepter une exception (chevauchement ou doublon) de façon motivée'),
 ('geo:merge','Remplacer un doublon de parcelle par une parcelle de référence'),
 ('geo:settings','Configurer les tolérances géométriques');
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, p.code FROM roles r CROSS JOIN permissions p WHERE r.code = 'coop_admin' ON CONFLICT DO NOTHING;
COMMIT;
