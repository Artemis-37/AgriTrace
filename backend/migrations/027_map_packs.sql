-- Fonds de carte hors ligne : paquet de tuiles raster (MBTiles) déposé par l'administrateur de la coopérative.
-- Le plus récent est celui que les téléphones téléchargent. Un paquet peut être retiré (le fichier est alors supprimé).
CREATE TABLE map_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  filename text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key text NOT NULL,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_map_packs_org ON map_packs (organization_id, uploaded_at DESC);
ALTER TABLE map_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE map_packs FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON map_packs
  USING (organization_id::text = current_setting('app.current_org', true))
  WITH CHECK (organization_id::text = current_setting('app.current_org', true));
CREATE TRIGGER map_packs_no_update BEFORE UPDATE ON map_packs FOR EACH ROW EXECUTE FUNCTION forbid_change();
