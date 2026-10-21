BEGIN;
-- Modules de formation proposés par un exportateur : exportateur → ADG → coachs, puis résultats des coachs → ADG → exportateur.
-- L'ADG ne fait que transmettre (un clic) : le contenu proposé et les résultats saisis sont figés par déclencheur.

CREATE TABLE training_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  submitted_by uuid NOT NULL REFERENCES users(id),
  theme text NOT NULL CHECK (length(btrim(theme)) BETWEEN 1 AND 120),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  summary text NOT NULL DEFAULT '' CHECK (length(summary) <= 1000),
  crops text[] NOT NULL DEFAULT '{cacao}',
  certifications text[] NOT NULL DEFAULT '{}',
  level text NOT NULL DEFAULT 'base' CHECK (level IN ('base','intermediaire','avance')),
  duration_min int NOT NULL DEFAULT 45 CHECK (duration_min BETWEEN 5 AND 600),
  content jsonb NOT NULL,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','forwarded','declined')),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  decline_reason text CHECK (decline_reason IS NULL OR length(decline_reason) <= 500),
  module_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX training_submissions_org ON training_submissions (organization_id, created_at DESC);
ALTER TABLE training_modules ADD COLUMN submission_id uuid REFERENCES training_submissions(id);
ALTER TABLE training_modules DROP CONSTRAINT training_modules_review_state_check;
ALTER TABLE training_modules ADD CONSTRAINT training_modules_review_state_check CHECK (review_state IN ('to_review','kept','edited','custom','exporter'));
ALTER TABLE training_submissions ADD CONSTRAINT training_submissions_module_fk FOREIGN KEY (module_id) REFERENCES training_modules(id) ON DELETE SET NULL;

CREATE TABLE training_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  submission_id uuid NOT NULL REFERENCES training_submissions(id),
  module_id uuid REFERENCES training_modules(id) ON DELETE SET NULL,
  coach_id uuid NOT NULL REFERENCES users(id),
  session_date date NOT NULL,
  village text NOT NULL DEFAULT '' CHECK (length(village) <= 150),
  participants int NOT NULL CHECK (participants BETWEEN 0 AND 5000),
  avg_score numeric(5,2) CHECK (avg_score IS NULL OR avg_score BETWEEN 0 AND 100),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','forwarded')),
  forwarded_by uuid REFERENCES users(id),
  forwarded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX training_results_org ON training_results (organization_id, created_at DESC);
CREATE INDEX training_results_submission ON training_results (submission_id);

-- Figé : seuls les champs de décision / transmission peuvent changer après création.
CREATE FUNCTION training_submissions_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.theme IS DISTINCT FROM OLD.theme OR NEW.title IS DISTINCT FROM OLD.title OR NEW.summary IS DISTINCT FROM OLD.summary OR NEW.crops IS DISTINCT FROM OLD.crops
     OR NEW.certifications IS DISTINCT FROM OLD.certifications OR NEW.level IS DISTINCT FROM OLD.level OR NEW.duration_min IS DISTINCT FROM OLD.duration_min
     OR NEW.content IS DISTINCT FROM OLD.content OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'Le contenu proposé par l''exportateur ne peut pas être modifié';
  END IF;
  IF OLD.status <> 'submitted' AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'Proposition déjà traitée'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER training_submissions_freeze BEFORE UPDATE ON training_submissions FOR EACH ROW EXECUTE FUNCTION training_submissions_freeze();
CREATE FUNCTION training_results_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.session_date IS DISTINCT FROM OLD.session_date OR NEW.village IS DISTINCT FROM OLD.village OR NEW.participants IS DISTINCT FROM OLD.participants
     OR NEW.avg_score IS DISTINCT FROM OLD.avg_score OR NEW.notes IS DISTINCT FROM OLD.notes OR NEW.coach_id IS DISTINCT FROM OLD.coach_id
     OR NEW.submission_id IS DISTINCT FROM OLD.submission_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'Le résultat saisi par le coach ne peut pas être modifié';
  END IF;
  IF OLD.status = 'forwarded' AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'Résultat déjà transmis'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER training_results_freeze BEFORE UPDATE ON training_results FOR EACH ROW EXECUTE FUNCTION training_results_freeze();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['training_submissions','training_results'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I USING (organization_id::text = current_setting('app.current_org', true)) WITH CHECK (organization_id::text = current_setting('app.current_org', true))$p$, t);
  END LOOP;
END $$;

INSERT INTO permissions(code, description) VALUES
 ('training:propose','Exportateur : proposer un module de formation et suivre ses propres propositions et résultats transmis'),
 ('training:forward','ADG : transmettre en un clic les modules des exportateurs aux coachs et les résultats aux exportateurs (sans modification)'),
 ('training:report','Coach : saisir les résultats d''un module transmis par un exportateur');
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, 'training:forward' FROM roles r WHERE r.code IN ('coop_admin','adg') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, 'training:report' FROM roles r WHERE r.code = 'coach' ON CONFLICT DO NOTHING;
COMMIT;
