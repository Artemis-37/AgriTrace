-- Couches de référence (zones protégées : parcs, réserves, forêts classées…) et contrôle des parcelles contre ces zones (EUDR, certification).
-- Les couches sont PROPRES À CHAQUE COOPÉRATIVE (chargées par son administrateur) et NE SONT PAS répliquées vers le central :
-- elles peuvent peser plusieurs Mo et leur licence (WDPA) n'autorise pas toute redistribution. Seules les anomalies en résultant le sont.
CREATE TABLE reference_layers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  code text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  kind text NOT NULL DEFAULT 'protected_area' CHECK (kind IN ('protected_area')),
  source text, license text, attribution text,
  filename text, sha256 text,
  feature_count integer NOT NULL DEFAULT 0,
  imported_by uuid, imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
CREATE TABLE reference_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  layer_id uuid NOT NULL REFERENCES reference_layers(id) ON DELETE CASCADE,
  name text NOT NULL,
  designation text, category text, status text, year integer,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  geometry jsonb NOT NULL,                -- GeoJSON Polygon ou MultiPolygon (WGS84), simplifié à l'import
  bbox box NOT NULL,
  area_ha numeric(14,2)
);
CREATE INDEX idx_reference_features_layer ON reference_features (layer_id);
CREATE INDEX idx_reference_features_bbox ON reference_features USING gist (bbox);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['reference_layers','reference_features'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I USING (organization_id::text = current_setting('app.current_org', true)) WITH CHECK (organization_id::text = current_setting('app.current_org', true))$p$, t);
  END LOOP;
END $$;

-- Anomalies : recouvrement d'une parcelle avec une zone protégée (pas de seconde parcelle). Aucune clé étrangère vers la zone :
-- l'anomalie est répliquée vers le central, qui ne reçoit pas les couches. Le nom de la zone est copié dans l'anomalie.
ALTER TABLE parcel_anomalies ADD COLUMN reference_feature_id uuid, ADD COLUMN reference_label text;
ALTER TABLE parcel_anomalies DROP CONSTRAINT IF EXISTS parcel_anomalies_kind_check;
ALTER TABLE parcel_anomalies ADD CONSTRAINT parcel_anomalies_kind_check
  CHECK (kind IN ('duplicate_identical','duplicate_equivalent','duplicate_near','overlap_partial','overlap_inclusion','invalid_geometry','protected_overlap'));
DROP INDEX uq_anomaly_open;
CREATE UNIQUE INDEX uq_anomaly_open ON parcel_anomalies (organization_id, kind, parcel_a,
  coalesce(parcel_b, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(reference_feature_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE status = 'open';

INSERT INTO permissions(code, description) VALUES ('geo:layers','Charger et gérer les couches de référence (zones protégées)') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code) SELECT r.id, 'geo:layers' FROM roles r WHERE r.code IN ('coop_admin','adg') ON CONFLICT DO NOTHING;

-- Les couches ne sont pas répliquées : on réécrit la liste d'exclusion de l'installation des déclencheurs.
CREATE OR REPLACE FUNCTION replication_install_triggers() RETURNS int AS $$
DECLARE r record; n int := 0; pkc text[]; ser boolean;
BEGIN
  FOR r IN
    SELECT c.relname AS t, c.oid,
           EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped) AS has_org
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND c.relname NOT IN ('organizations','users','permissions','schema_migrations','user_sessions','devices','sync_operations','notifications',
                             'replication_tables','replication_link','replication_sites','sync_outbox','reference_layers','reference_features')
       AND (c.relname = 'role_permissions' OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped))
  LOOP
    SELECT array_agg(a.attname ORDER BY k.ord) INTO pkc
      FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
     WHERE i.indrelid = r.oid AND i.indisprimary;
    ser := cardinality(pkc) = 1 AND EXISTS (
      SELECT 1 FROM pg_attribute a WHERE a.attrelid = r.oid AND a.attname = pkc[1] AND a.atttypid IN ('bigint'::regtype, 'integer'::regtype));
    INSERT INTO replication_tables(tbl, org_via, pk_cols, serial_id)
      VALUES (r.t, CASE WHEN r.has_org THEN 'direct' ELSE 'role' END, pkc, ser)
      ON CONFLICT (tbl) DO UPDATE SET org_via = EXCLUDED.org_via, pk_cols = EXCLUDED.pk_cols, serial_id = EXCLUDED.serial_id;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = r.oid AND tgname = 'trg_replication_capture') THEN
      EXECUTE format('CREATE TRIGGER trg_replication_capture AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION replication_capture()', r.t);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$ LANGUAGE plpgsql;
