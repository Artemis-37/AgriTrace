-- Réplique des serveurs locaux Windows : le central conserve, par coopérative, la dernière version de chaque ligne reçue.
-- Format générique (jsonb) : aucune dépendance au schéma relationnel du central ; une vue métier peut s'y brancher plus tard.
BEGIN;
CREATE TABLE windows_replica (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  tbl text NOT NULL CHECK (tbl ~ '^[a-z_][a-z0-9_]{0,62}$'),
  sync_id text NOT NULL CHECK (length(sync_id) BETWEEN 8 AND 64),
  row jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  site_id uuid NOT NULL REFERENCES replication_sites(id),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, tbl, sync_id)
);
CREATE INDEX windows_replica_org_tbl ON windows_replica (organization_id, tbl, updated_at);
ALTER TABLE windows_replica ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON windows_replica USING (organization_id::text = current_setting('app.current_org', true)) WITH CHECK (organization_id::text = current_setting('app.current_org', true));
COMMIT;
