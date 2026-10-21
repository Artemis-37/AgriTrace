BEGIN;
-- Modèles de saisie de terrain propres à chaque coopérative, rédigés par l'ADG puis déployés vers les coachs.
--  kind = 'infrastructure'  : une catégorie d'infrastructure (École, Centre de santé…) et son questionnaire.
--  kind = 'training_theme'  : un thème de formation et ses modules.
-- Le brouillon (definition) n'atteint les coachs qu'une fois déployé (deployed_definition, version incrémentée).
CREATE TABLE field_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  kind text NOT NULL CHECK (kind IN ('infrastructure','training_theme')),
  category text NOT NULL CHECK (length(category) BETWEEN 1 AND 120),
  definition jsonb NOT NULL,
  deployed_definition jsonb,
  deployed_at timestamptz,
  version int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, kind, category)
);
ALTER TABLE field_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON field_templates
  USING (organization_id::text = current_setting('app.current_org', true))
  WITH CHECK (organization_id::text = current_setting('app.current_org', true));

INSERT INTO permissions(code, description) VALUES
 ('field_templates:manage','Rédiger et déployer les modèles de saisie de terrain (infrastructures, thèmes de formation) et le catalogue des articles');
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
   WHERE r.code = 'coop_admin' AND p.code = 'field_templates:manage' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
   WHERE r.code = 'adg' AND p.code IN ('field_templates:manage','field_records:read','field_records:manage') ON CONFLICT DO NOTHING;
COMMIT;
