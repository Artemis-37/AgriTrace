-- Serveur local / serveur central : réplication à sens unique (local → central).
-- Le serveur local reste autonome ; chaque changement d'une table de l'organisation est capté dans sync_outbox
-- puis envoyé au central, qui consolide toutes les coopératives.
BEGIN;

-- Tables répliquées : nom, façon de retrouver l'organisation, clé primaire.
CREATE TABLE replication_tables (
  tbl text PRIMARY KEY,
  org_via text NOT NULL CHECK (org_via IN ('direct','role')),
  pk_cols text[] NOT NULL,
  serial_id boolean NOT NULL DEFAULT false   -- id numérique propre à chaque base : ne se copie pas, on laisse la base du central en attribuer un
);

-- Lien d'un serveur local avec son central (une seule ligne).
CREATE TABLE replication_link (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  central_url text NOT NULL,
  site_id uuid NOT NULL,
  site_token text NOT NULL,
  organization_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  acked_txid bigint NOT NULL DEFAULT 0,
  linked_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz, last_ok_at timestamptz, last_error text,
  rows_sent bigint NOT NULL DEFAULT 0
);

-- File d'attente des changements à envoyer. txid = transaction d'origine : le curseur avance par transaction terminée,
-- ce qui évite de sauter une ligne dont la transaction se termine après une plus récente.
CREATE TABLE sync_outbox (
  seq bigserial PRIMARY KEY,
  txid bigint NOT NULL DEFAULT (pg_current_xact_id()::text)::bigint,
  org_id uuid NOT NULL,
  tbl text NOT NULL,
  op char(1) NOT NULL CHECK (op IN ('U','D')),
  pk jsonb NOT NULL,
  row jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sync_outbox_tx ON sync_outbox (txid, seq);

-- Côté central : un site par serveur local.
CREATE TABLE replication_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  last_txid bigint NOT NULL DEFAULT 0,
  rows_received bigint NOT NULL DEFAULT 0,
  schema_version text, app_version text,
  last_push_at timestamptz, last_error text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid
);
CREATE UNIQUE INDEX uq_sites_org ON replication_sites (organization_id);

-- Fonction de capture (appelée par les déclencheurs AFTER ... FOR EACH ROW).
CREATE OR REPLACE FUNCTION replication_capture() RETURNS trigger AS $$
DECLARE
  rec jsonb; reg replication_tables%ROWTYPE; org uuid; pkj jsonb := '{}'::jsonb; c text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM replication_link WHERE enabled) THEN RETURN NULL; END IF;
  SELECT * INTO reg FROM replication_tables WHERE tbl = TG_TABLE_NAME;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN rec := to_jsonb(OLD); ELSE rec := to_jsonb(NEW); END IF;
  IF reg.org_via = 'direct' THEN org := (rec->>'organization_id')::uuid;
  ELSE SELECT organization_id INTO org FROM roles WHERE id = (rec->>'role_id')::uuid;
  END IF;
  IF org IS NULL OR org <> (SELECT organization_id FROM replication_link) THEN RETURN NULL; END IF;
  FOREACH c IN ARRAY reg.pk_cols LOOP pkj := pkj || jsonb_build_object(c, rec->c); END LOOP;
  IF TG_OP = 'DELETE' THEN
    INSERT INTO sync_outbox(org_id, tbl, op, pk) VALUES (org, TG_TABLE_NAME, 'D', pkj);
  ELSE
    INSERT INTO sync_outbox(org_id, tbl, op, pk, row) VALUES (org, TG_TABLE_NAME, 'U', pkj, rec);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

-- Inscrit toutes les tables d'organisation (idempotent). À rappeler après toute migration qui ajoute une table.
CREATE OR REPLACE FUNCTION replication_install_triggers() RETURNS int AS $$
DECLARE r record; n int := 0; pkc text[]; ser boolean;
BEGIN
  FOR r IN
    SELECT c.relname AS t, c.oid,
           EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped) AS has_org
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND c.relname NOT IN ('organizations','users','permissions','schema_migrations','user_sessions','devices','sync_operations','notifications',
                             'replication_tables','replication_link','replication_sites','sync_outbox')
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

-- Envoi initial : met en file l'état courant de l'organisation (à appeler sous le contexte app.current_org de l'organisation).
CREATE OR REPLACE FUNCTION replication_backfill(org uuid) RETURNS bigint AS $$
DECLARE r replication_tables%ROWTYPE; total bigint := 0; k bigint; pkexpr text;
BEGIN
  FOR r IN SELECT * FROM replication_tables ORDER BY tbl LOOP
    SELECT string_agg(format('%L, to_jsonb(t)->%L', c, c), ', ') INTO pkexpr FROM unnest(r.pk_cols) c;
    IF r.org_via = 'direct' THEN
      EXECUTE format('INSERT INTO sync_outbox(org_id, tbl, op, pk, row) SELECT $1, %L, ''U'', jsonb_build_object(%s), to_jsonb(t) FROM %I t WHERE t.organization_id = $1', r.tbl, pkexpr, r.tbl) USING org;
    ELSE
      EXECUTE format('INSERT INTO sync_outbox(org_id, tbl, op, pk, row) SELECT $1, %L, ''U'', jsonb_build_object(%s), to_jsonb(t) FROM %I t WHERE t.role_id IN (SELECT id FROM roles WHERE organization_id = $1)', r.tbl, pkexpr, r.tbl) USING org;
    END IF;
    GET DIAGNOSTICS k = ROW_COUNT; total := total + k;
  END LOOP;
  RETURN total;
END $$ LANGUAGE plpgsql;

SELECT replication_install_triggers();

-- Droit de désactiver les déclencheurs pendant l'application des changements reçus (PostgreSQL 15+). Sans lui, le central ne peut pas recevoir.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agritrace_app') THEN
    BEGIN
      EXECUTE 'GRANT SET ON PARAMETER session_replication_role TO agritrace_app';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'GRANT SET ON PARAMETER impossible (%): à accorder par un super-utilisateur pour activer le mode central', SQLERRM;
    END;
  END IF;
END $$;

INSERT INTO permissions(code, description) VALUES ('replication:manage','Gérer la synchronisation avec le serveur central');
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, 'replication:manage' FROM roles r WHERE r.code = 'coop_admin' ON CONFLICT DO NOTHING;
COMMIT;
