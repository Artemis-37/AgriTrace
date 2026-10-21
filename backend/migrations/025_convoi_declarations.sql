-- Liaison d'un convoi à des déclarations d'achat précises (une déclaration ne part que dans un seul convoi).
CREATE TABLE convoy_declarations (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  convoy_id uuid NOT NULL REFERENCES convoys(id),
  declaration_id uuid NOT NULL REFERENCES purchase_declarations(id),
  kg numeric(18,3) NOT NULL CHECK (kg >= 0),
  bags integer NOT NULL DEFAULT 0 CHECK (bags >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (convoy_id, declaration_id),
  UNIQUE (declaration_id)
);
CREATE INDEX idx_convoy_declarations_org ON convoy_declarations (organization_id, convoy_id);
ALTER TABLE convoy_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE convoy_declarations FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON convoy_declarations
  USING (organization_id::text = current_setting('app.current_org', true))
  WITH CHECK (organization_id::text = current_setting('app.current_org', true));
CREATE TRIGGER convoy_declarations_immutable BEFORE UPDATE OR DELETE ON convoy_declarations FOR EACH ROW EXECUTE FUNCTION forbid_change();
