BEGIN;
-- 1. Versions de géométrie des parcelles (CDC §8.6) : chaque nouvelle géométrie est conservée, numérotée, non modifiable.
CREATE TABLE parcel_geometry_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  parcel_id uuid NOT NULL REFERENCES parcels(id),
  version integer NOT NULL CHECK (version >= 1),
  geometry jsonb NOT NULL,
  area_ha numeric(12,4),
  geometry_hash text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parcel_id, version)
);
CREATE TRIGGER trg_parcel_geometry_versions_immutable BEFORE UPDATE OR DELETE ON parcel_geometry_versions FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE FUNCTION parcel_geometry_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.geometry IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.geometry IS DISTINCT FROM OLD.geometry) THEN
    INSERT INTO parcel_geometry_versions(organization_id, parcel_id, version, geometry, area_ha, geometry_hash)
    VALUES (NEW.organization_id, NEW.id, coalesce((SELECT max(version) FROM parcel_geometry_versions WHERE parcel_id = NEW.id), 0) + 1,
            NEW.geometry, NEW.geometry_area_ha, NEW.geometry_hash);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_parcels_geometry_version AFTER INSERT OR UPDATE OF geometry ON parcels FOR EACH ROW EXECUTE FUNCTION parcel_geometry_version();
INSERT INTO parcel_geometry_versions(organization_id, parcel_id, version, geometry, area_ha, geometry_hash, changed_at)
  SELECT organization_id, id, 1, geometry, geometry_area_ha, geometry_hash, created_at FROM parcels WHERE geometry IS NOT NULL;

-- 2. Relevés bancaires importés (CSV) et pointage avec les opérations du compte.
CREATE TABLE bank_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  account_id uuid NOT NULL REFERENCES financial_accounts(id),
  filename text NOT NULL,
  file_sha256 text NOT NULL,
  period_from date, period_to date,
  line_count integer NOT NULL,
  imported_by uuid NOT NULL REFERENCES users(id),
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, file_sha256)
);
CREATE TABLE bank_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  statement_id uuid NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  op_date date NOT NULL,
  label text NOT NULL,
  reference text,
  amount numeric(18,4) NOT NULL CHECK (amount <> 0),   -- positif : entrée sur le compte, négatif : sortie
  status text NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched','matched','ignored')),
  match_tx_id uuid REFERENCES financial_transactions(id),
  matched_by uuid REFERENCES users(id), matched_at timestamptz,
  auto_matched boolean NOT NULL DEFAULT false,
  note text,
  UNIQUE (statement_id, line_no),
  CHECK ((status = 'matched') = (match_tx_id IS NOT NULL))
);
CREATE UNIQUE INDEX uq_bank_line_tx ON bank_statement_lines (match_tx_id) WHERE match_tx_id IS NOT NULL;
CREATE INDEX idx_bank_lines_status ON bank_statement_lines (statement_id, status);

-- 3. Rapports envoyés automatiquement (CDC §26).
CREATE TABLE report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  report text NOT NULL CHECK (report IN ('purchases','finance','stock','quality')),
  frequency text NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
  weekday smallint CHECK (weekday BETWEEN 1 AND 7),
  month_day smallint CHECK (month_day BETWEEN 1 AND 28),
  hour smallint NOT NULL DEFAULT 6 CHECK (hour BETWEEN 0 AND 23),
  recipients uuid[] NOT NULL CHECK (cardinality(recipients) BETWEEN 1 AND 50),
  send_email boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  last_run_on date,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (frequency <> 'weekly' OR weekday IS NOT NULL),
  CHECK (frequency <> 'monthly' OR month_day IS NOT NULL)
);
CREATE TABLE report_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  schedule_id uuid REFERENCES report_schedules(id) ON DELETE SET NULL,
  report text NOT NULL,
  filename text NOT NULL,
  period_from date, period_to date,
  xlsx bytea NOT NULL,
  emailed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Notifications poussées : jetons d'appareil (propres à l'utilisateur) et marquage d'envoi.
CREATE TABLE push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  token text NOT NULL UNIQUE,
  platform text NOT NULL DEFAULT 'android' CHECK (platform IN ('android','ios','web')),
  device_label text,
  created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX idx_push_tokens_user ON push_tokens (user_id) WHERE revoked_at IS NULL;
ALTER TABLE notifications ADD COLUMN push_sent_at timestamptz;
CREATE INDEX idx_notifications_push ON notifications (created_at) WHERE push_sent_at IS NULL;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['parcel_geometry_versions','bank_statements','bank_statement_lines','report_schedules','report_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I USING (organization_id::text = current_setting('app.current_org', true))
      WITH CHECK (organization_id::text = current_setting('app.current_org', true))$p$, t);
  END LOOP;
END $$;

INSERT INTO permissions(code, description) VALUES
  ('reports:schedule','Programmer l''envoi automatique des rapports');
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, 'reports:schedule' FROM roles r WHERE r.code IN ('coop_admin','adg') ON CONFLICT DO NOTHING;
COMMIT;
