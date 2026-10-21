-- Moteur géospatial PostGIS (étape facultative, rejouée à chaque `npm run migrate` : elle s'active dès que l'extension devient disponible)
-- Moteur géospatial PostGIS (CDC §10 : « moteur adapté, tel que PostGIS, avec index spatiaux »).
-- PostGIS est OPTIONNEL : le serveur local embarqué dans l'application de bureau n'en dispose pas. Quand l'extension n'est pas disponible,
-- cette migration ne fait rien et l'application calcule les chevauchements elle-même (même classement, voir docs/CARTOGRAPHIE.md).
-- Quand elle l'est : colonne géométrique GÉNÉRÉE depuis le GeoJSON (donc jamais désynchronisée, et ignorée par la réplication), index GiST.
DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'postgis') THEN
    RAISE NOTICE 'PostGIS absent de ce serveur PostgreSQL : les chevauchements restent calculés par l''application';
    RETURN;
  END IF;
  BEGIN
    CREATE EXTENSION IF NOT EXISTS postgis;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PostGIS non activé (%) : à activer par un super-utilisateur (CREATE EXTENSION postgis;) puis relancer la migration de la colonne', SQLERRM;
    RETURN;
  END;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'parcels'::regclass AND attname = 'geom' AND NOT attisdropped) THEN
    EXECUTE $q$ALTER TABLE parcels ADD COLUMN geom geometry(Polygon, 4326)
      GENERATED ALWAYS AS (CASE WHEN geometry IS NULL THEN NULL ELSE ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON(geometry)), 4326) END) STORED$q$;
  END IF;
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_parcels_geom ON parcels USING gist (geom)';
END
$mig$;
