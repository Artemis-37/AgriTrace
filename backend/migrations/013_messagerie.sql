-- Messagerie interne entre les postes d'une coopérative (canal général et messages directs).
-- Les messages restent sur le serveur de la coopérative : ils ne sont pas répliqués vers le central.
BEGIN;
CREATE OR REPLACE FUNCTION replication_install_triggers() RETURNS int AS $$
DECLARE r record; n int := 0; pkc text[]; ser boolean;
BEGIN
  FOR r IN
    SELECT c.relname AS t, c.oid,
           EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped) AS has_org
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND c.relname NOT IN ('organizations','users','permissions','schema_migrations','user_sessions','devices','sync_operations','notifications',
                             'replication_tables','replication_link','replication_sites','sync_outbox','messages','message_seen')
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

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  sender_id uuid NOT NULL REFERENCES users(id),
  recipient_id uuid REFERENCES users(id),            -- NULL = canal général de la coopérative
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  idempotency_key text NOT NULL,
  sent_at timestamptz,                                -- heure de rédaction sur le poste (peut précéder la réception si le poste était hors connexion)
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX idx_messages_thread ON messages (organization_id, recipient_id, created_at);
CREATE INDEX idx_messages_sender ON messages (organization_id, sender_id, created_at);
CREATE TABLE message_seen (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  peer_key text NOT NULL,                              -- 'general' ou l'identifiant de l'interlocuteur
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, peer_key)
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['messages','message_seen'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I
      USING (organization_id::text = current_setting('app.current_org', true))
      WITH CHECK (organization_id::text = current_setting('app.current_org', true))$p$, t);
  END LOOP;
END $$;
CREATE TRIGGER trg_messages_immutable BEFORE UPDATE OR DELETE ON messages FOR EACH ROW EXECUTE FUNCTION forbid_change();

INSERT INTO permissions(code, description) VALUES ('messages:use','Échanger des messages avec les autres postes de la coopérative');
INSERT INTO role_permissions(role_id, permission_code) SELECT id, 'messages:use' FROM roles ON CONFLICT DO NOTHING;
COMMIT;
