-- 066 : le central conserve tout. Une suppression venue d'un serveur local n'efface rien au central : elle est archivée.
-- Journal des fichiers de transfert (clé USB) importés au central.
BEGIN;
CREATE TABLE replication_archive (
  id bigserial PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES replication_sites(id),
  organization_id uuid NOT NULL,
  tbl text NOT NULL, pk jsonb NOT NULL, txid bigint NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER replication_archive_immutable BEFORE UPDATE OR DELETE ON replication_archive FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE transfer_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES replication_sites(id),
  file_sha256 text NOT NULL UNIQUE,
  file_name text, batches int NOT NULL, rows_total int NOT NULL, rows_applied int NOT NULL, last_txid bigint NOT NULL,
  imported_by uuid, imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER transfer_imports_immutable BEFORE UPDATE OR DELETE ON transfer_imports FOR EACH ROW EXECUTE FUNCTION forbid_change();
COMMIT;
