-- Versions de l'application de bureau mises à disposition des postes d'une coopérative (installateur Windows déposé par l'administrateur).
-- Table commune (pas de coopérative) : c'est le même installateur pour tous. Les enregistrements ne se modifient pas.
CREATE TABLE app_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE CHECK (version ~ '^\d{1,4}\.\d{1,4}\.\d{1,4}$'),
  filename text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key text NOT NULL,
  notes text,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER app_releases_immutable BEFORE UPDATE OR DELETE ON app_releases FOR EACH ROW EXECUTE FUNCTION forbid_change();
