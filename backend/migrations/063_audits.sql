-- 063 : module d'audit. L'exportateur (supérieur hiérarchique) audite les coopératives qu'il supervise ; le lien de supervision est accepté par la coopérative.
-- Les données ne sont jamais lues dans l'organisation de l'autre : chaque partie PARTAGE dans l'espace de l'audit des extraits figés ou des documents,
-- visibles des seuls participants désignés de l'audit.
BEGIN;

CREATE TABLE org_supervisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_org_id uuid NOT NULL REFERENCES organizations(id),
  supervised_org_id uuid NOT NULL REFERENCES organizations(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked')),
  requested_by uuid NOT NULL, accepted_by uuid, accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (supervisor_org_id <> supervised_org_id), UNIQUE (supervisor_org_id, supervised_org_id)
);
CREATE TABLE audit_counters (organization_id uuid NOT NULL REFERENCES organizations(id), year int NOT NULL, last_no int NOT NULL DEFAULT 0, PRIMARY KEY (organization_id, year));

CREATE TABLE audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_org_id uuid NOT NULL REFERENCES organizations(id),
  supervised_org_id uuid NOT NULL REFERENCES organizations(id),
  number text NOT NULL, title text NOT NULL CHECK (length(btrim(title)) >= 3),
  scope text[] NOT NULL DEFAULT '{}', starts_on date, ends_on date,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','findings_issued','closed','cancelled')),
  summary text,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz, issued_at timestamptz, closed_at timestamptz, closed_by uuid,
  UNIQUE (supervisor_org_id, number)
);
CREATE TABLE audit_participants (
  audit_id uuid NOT NULL REFERENCES audits(id), organization_id uuid NOT NULL REFERENCES organizations(id), user_id uuid NOT NULL,
  added_by uuid NOT NULL, added_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (audit_id, user_id)
);
CREATE TABLE audit_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES audits(id),
  supervisor_org_id uuid NOT NULL REFERENCES organizations(id), supervised_org_id uuid NOT NULL REFERENCES organizations(id),
  no int NOT NULL,
  area text NOT NULL CHECK (area IN ('tracabilite','stock','pesee','comptabilite','caisse','social','environnement','autre')),
  result text NOT NULL CHECK (result IN ('conform','observation','minor','major','critical')),
  requirement text NOT NULL, description text NOT NULL, evidence text, due_on date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','responded','verified')),
  response text, action_plan text, action_due_on date, responded_by uuid, responded_at timestamptz,
  verified_by uuid, verified_at timestamptz, verification_comment text,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_id, no)
);
CREATE TABLE audit_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES audits(id),
  shared_by_org uuid NOT NULL REFERENCES organizations(id), shared_by_user uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('snapshot','document','note')),
  title text NOT NULL CHECK (length(btrim(title)) >= 2),
  view_key text, params jsonb, payload jsonb,
  file_name text, file_mime text, file_sha256 text, file_bytes bytea,
  withdrawn_at timestamptz, withdrawn_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_shares_audit ON audit_shares(audit_id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['org_supervisions','audit_counters','audits','audit_participants','audit_findings','audit_shares'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
CREATE POLICY parties ON org_supervisions
  USING (supervisor_org_id::text = current_setting('app.current_org', true) OR supervised_org_id::text = current_setting('app.current_org', true))
  WITH CHECK (supervisor_org_id::text = current_setting('app.current_org', true) OR supervised_org_id::text = current_setting('app.current_org', true));
CREATE POLICY org_isolation ON audit_counters USING (organization_id::text = current_setting('app.current_org', true)) WITH CHECK (organization_id::text = current_setting('app.current_org', true));
-- audits : visibles des deux organisations (la supervisée dès que l'audit est lancé ou programmé), modifiables par le superviseur
CREATE POLICY audits_read ON audits FOR SELECT USING (supervisor_org_id::text = current_setting('app.current_org', true) OR supervised_org_id::text = current_setting('app.current_org', true));
CREATE POLICY audits_write ON audits FOR ALL USING (supervisor_org_id::text = current_setting('app.current_org', true)) WITH CHECK (supervisor_org_id::text = current_setting('app.current_org', true));
CREATE POLICY participants_read ON audit_participants FOR SELECT USING (EXISTS (SELECT 1 FROM audits a WHERE a.id = audit_id));
CREATE POLICY participants_write ON audit_participants FOR ALL USING (organization_id::text = current_setting('app.current_org', true)) WITH CHECK (organization_id::text = current_setting('app.current_org', true));
CREATE POLICY findings_owner ON audit_findings FOR ALL USING (supervisor_org_id::text = current_setting('app.current_org', true)) WITH CHECK (supervisor_org_id::text = current_setting('app.current_org', true));
-- la coopérative ne voit les constats qu'une fois le rapport émis, et ne peut qu'y répondre (colonnes contrôlées par le déclencheur)
CREATE POLICY findings_supervised_read ON audit_findings FOR SELECT USING (supervised_org_id::text = current_setting('app.current_org', true) AND EXISTS (SELECT 1 FROM audits a WHERE a.id = audit_id AND a.status IN ('findings_issued','closed')));
CREATE POLICY findings_supervised_respond ON audit_findings FOR UPDATE USING (supervised_org_id::text = current_setting('app.current_org', true) AND EXISTS (SELECT 1 FROM audits a WHERE a.id = audit_id AND a.status = 'findings_issued'))
  WITH CHECK (supervised_org_id::text = current_setting('app.current_org', true));
CREATE POLICY shares_read ON audit_shares FOR SELECT USING (EXISTS (SELECT 1 FROM audits a WHERE a.id = audit_id));
CREATE POLICY shares_write ON audit_shares FOR ALL USING (shared_by_org::text = current_setting('app.current_org', true)) WITH CHECK (shared_by_org::text = current_setting('app.current_org', true));

CREATE FUNCTION audit_findings_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cur text := current_setting('app.current_org', true);
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Un constat ne se supprime pas'; END IF;
  IF cur = OLD.supervised_org_id::text AND cur <> OLD.supervisor_org_id::text THEN
    IF OLD.status <> 'open' THEN RAISE EXCEPTION 'Ce constat a déjà reçu une réponse'; END IF;
    IF (NEW.area, NEW.result, NEW.requirement, NEW.description, NEW.evidence, NEW.due_on, NEW.no, NEW.audit_id, NEW.verified_by, NEW.verified_at, NEW.verification_comment, NEW.created_by)
       IS DISTINCT FROM (OLD.area, OLD.result, OLD.requirement, OLD.description, OLD.evidence, OLD.due_on, OLD.no, OLD.audit_id, OLD.verified_by, OLD.verified_at, OLD.verification_comment, OLD.created_by) OR NEW.status <> 'responded' THEN
      RAISE EXCEPTION 'La coopérative ne peut que répondre au constat'; END IF;
  ELSIF OLD.status = 'verified' THEN RAISE EXCEPTION 'Un constat vérifié ne change plus'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER audit_findings_guard BEFORE UPDATE OR DELETE ON audit_findings FOR EACH ROW EXECUTE FUNCTION audit_findings_guard();

CREATE FUNCTION audit_status_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM audits WHERE id = NEW.audit_id;
  IF TG_TABLE_NAME = 'audit_findings' AND st <> 'in_progress' THEN RAISE EXCEPTION 'Les constats se saisissent pendant l''audit'; END IF;
  IF TG_TABLE_NAME = 'audit_shares' AND st NOT IN ('planned','in_progress','findings_issued') THEN RAISE EXCEPTION 'Cet audit est clos : plus aucun partage'; END IF;
  IF TG_TABLE_NAME = 'audit_participants' AND st IN ('closed','cancelled') THEN RAISE EXCEPTION 'Cet audit est clos'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER audit_findings_status BEFORE INSERT ON audit_findings FOR EACH ROW EXECUTE FUNCTION audit_status_guard();
CREATE TRIGGER audit_shares_status BEFORE INSERT ON audit_shares FOR EACH ROW EXECUTE FUNCTION audit_status_guard();
CREATE TRIGGER audit_participants_status BEFORE INSERT ON audit_participants FOR EACH ROW EXECUTE FUNCTION audit_status_guard();

-- Un partage ne se modifie pas ; seul son retrait (le contenu est alors effacé) est possible.
CREATE FUNCTION audit_shares_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Un partage ne se supprime pas : retirez-le'; END IF;
  IF OLD.withdrawn_at IS NOT NULL THEN RAISE EXCEPTION 'Ce partage est déjà retiré'; END IF;
  IF (NEW.title, NEW.kind, NEW.view_key, NEW.params, NEW.shared_by_org, NEW.shared_by_user, NEW.audit_id, NEW.file_name, NEW.file_sha256) IS DISTINCT FROM (OLD.title, OLD.kind, OLD.view_key, OLD.params, OLD.shared_by_org, OLD.shared_by_user, OLD.audit_id, OLD.file_name, OLD.file_sha256) THEN
    RAISE EXCEPTION 'Un partage ne se modifie pas'; END IF;
  IF NEW.withdrawn_at IS NULL THEN RAISE EXCEPTION 'Un partage ne se modifie pas'; END IF;
  NEW.payload := NULL; NEW.file_bytes := NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER audit_shares_guard BEFORE UPDATE OR DELETE ON audit_shares FOR EACH ROW EXECUTE FUNCTION audit_shares_guard();

CREATE FUNCTION audits_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Un audit ne se supprime pas'; END IF;
  IF OLD.status IN ('closed','cancelled') THEN RAISE EXCEPTION 'Cet audit est clos'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER audits_guard BEFORE UPDATE OR DELETE ON audits FOR EACH ROW EXECUTE FUNCTION audits_guard();

INSERT INTO permissions(code, description) VALUES
 ('audits:manage','Audit (exportateur) : programmer un audit, désigner les auditeurs, saisir les constats, émettre le rapport, vérifier les réponses, clore'),
 ('audits:read','Audit : voir les audits où l''on est participant'),
 ('audits:share','Audit : partager des données ou des documents dans l''espace de l''audit'),
 ('audits:respond','Audit (coopérative) : désigner les participants de la coopérative et répondre aux constats');
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, p FROM roles r, unnest(ARRAY['audits:manage','audits:read','audits:share','audits:respond']) p WHERE r.code = 'coop_admin' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code) SELECT r.id, p FROM roles r, unnest(ARRAY['audits:read','audits:share','audits:respond']) p WHERE r.code = 'responsable_tracabilite' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code) SELECT id, 'audits:read' FROM roles WHERE code IN ('direction','responsable_qualite','auditeur') ON CONFLICT DO NOTHING;
COMMIT;
