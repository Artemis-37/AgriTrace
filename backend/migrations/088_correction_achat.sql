-- Correction d'un achat mal saisi par le responsable de traçabilité (le délégué l'a prévenu par téléphone) :
-- droit « declarations:correct », et journal des corrections (anciennes et nouvelles valeurs, motif, auteur).
BEGIN;
INSERT INTO permissions(code, description) VALUES ('declarations:correct','Corriger un achat mal saisi (poids, sacs, date, producteur), avec motif');
INSERT INTO role_permissions(role_id, permission_code)
  SELECT id, 'declarations:correct' FROM roles WHERE code IN ('coop_admin','responsable_tracabilite') ON CONFLICT DO NOTHING;

CREATE TABLE purchase_declaration_corrections (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  declaration_id uuid NOT NULL REFERENCES purchase_declarations(id),
  old_values jsonb NOT NULL,
  new_values jsonb NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  actor_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_declaration_corrections_decl ON purchase_declaration_corrections (declaration_id, created_at);
ALTER TABLE purchase_declaration_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_declaration_corrections FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON purchase_declaration_corrections
  USING (organization_id::text = current_setting('app.current_org', true))
  WITH CHECK (organization_id::text = current_setting('app.current_org', true));
COMMIT;
