-- L'ADG indique, en transmettant un module (ou en affectant un modèle de la bibliothèque), la NATURE de l'élément
-- (module de formation, distribution ou tâche) et sa CIBLE (tous les producteurs ou certains) : il s'ajoute au profil de chacun.
BEGIN;
CREATE TABLE producer_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  kind text NOT NULL CHECK (kind IN ('formation','distribution','tache')),
  scope text NOT NULL CHECK (scope IN ('all','selected')),
  title text NOT NULL,
  instructions text NOT NULL DEFAULT '',
  due_date date,
  module_id uuid REFERENCES training_modules(id),
  submission_id uuid REFERENCES training_submissions(id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE producer_assignment_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  assignment_id uuid NOT NULL REFERENCES producer_assignments(id) ON DELETE CASCADE,
  producer_id uuid NOT NULL REFERENCES producers(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done')),
  done_at timestamptz, done_by uuid,
  UNIQUE (assignment_id, producer_id)
);
CREATE INDEX idx_pat_producer ON producer_assignment_targets (organization_id, producer_id, status);
CREATE INDEX idx_pat_assignment ON producer_assignment_targets (assignment_id);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['producer_assignments','producer_assignment_targets'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I USING (organization_id::text = current_setting('app.current_org', true)) WITH CHECK (organization_id::text = current_setting('app.current_org', true))$p$, t);
  END LOOP;
END $$;
INSERT INTO permissions(code, description) VALUES
 ('training:assign','ADG : affecter un module, une distribution ou une tâche à tous les producteurs ou à certains (il s''ajoute à leur profil)');
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, 'training:assign' FROM roles r WHERE r.code IN ('coop_admin','adg') ON CONFLICT DO NOTHING;
COMMIT;
