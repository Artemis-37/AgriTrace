-- Tâches (questionnaires) proposées par un exportateur : exportateur → ADG → coachs, puis réponses des coachs → ADG → exportateur.
-- Même circuit que les modules de formation : l'ADG transmet en un clic, sans modifier les questions ni les réponses.
BEGIN;
CREATE TABLE task_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  submitted_by uuid NOT NULL REFERENCES users(id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  questions jsonb NOT NULL CHECK (jsonb_typeof(questions) = 'array' AND jsonb_array_length(questions) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','forwarded','declined')),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  decline_reason text CHECK (decline_reason IS NULL OR length(decline_reason) <= 500),
  questionnaire_id uuid REFERENCES questionnaires(id) ON DELETE SET NULL,
  assignment_id uuid REFERENCES producer_assignments(id) ON DELETE SET NULL,
  results_forwarded_by uuid REFERENCES users(id),
  results_forwarded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_submissions_org ON task_submissions (organization_id, created_at DESC);
ALTER TABLE task_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_submissions FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON task_submissions USING (organization_id::text = current_setting('app.current_org', true)) WITH CHECK (organization_id::text = current_setting('app.current_org', true));

INSERT INTO permissions(code, description) VALUES
 ('tasks:propose','Exportateur : créer une tâche (questionnaire) et la proposer à l''ADG, suivre ses propositions et les réponses transmises')
 ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code) SELECT r.id, 'tasks:propose' FROM roles r WHERE r.code = 'exportateur' ON CONFLICT DO NOTHING;
SELECT replication_install_triggers();
COMMIT;
