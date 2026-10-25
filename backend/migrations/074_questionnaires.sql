-- Tâches = questionnaires : l'ADG ou l'administrateur crée (ou importe) un questionnaire, l'affecte à tous les producteurs ou à certains ;
-- le coach rencontre le producteur et renseigne ses réponses. Réponses conservées avec leur auteur et leur date.
BEGIN;
CREATE TABLE questionnaires (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  questions jsonb NOT NULL CHECK (jsonb_typeof(questions) = 'array' AND jsonb_array_length(questions) BETWEEN 1 AND 200),
  archived boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_questionnaires_org ON questionnaires (organization_id, created_at DESC);
ALTER TABLE producer_assignments ADD COLUMN questionnaire_id uuid REFERENCES questionnaires(id);
CREATE TABLE questionnaire_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  target_id uuid NOT NULL UNIQUE REFERENCES producer_assignment_targets(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES producer_assignments(id) ON DELETE CASCADE,
  producer_id uuid NOT NULL REFERENCES producers(id),
  answers jsonb NOT NULL,
  answered_by uuid NOT NULL,
  answered_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_qanswers_assignment ON questionnaire_answers (assignment_id);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['questionnaires','questionnaire_answers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I USING (organization_id::text = current_setting('app.current_org', true)) WITH CHECK (organization_id::text = current_setting('app.current_org', true))$p$, t);
  END LOOP;
END $$;
INSERT INTO permissions(code, description) VALUES ('questionnaires:manage','Créer, importer et archiver des questionnaires (tâches) à affecter aux producteurs') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code) SELECT r.id, 'questionnaires:manage' FROM roles r WHERE r.code IN ('coop_admin','adg') ON CONFLICT DO NOTHING;
SELECT replication_install_triggers();
COMMIT;
