-- 065 : pièces jointes d'un chargement (fiche d'accompagnement Excel/PDF, connaissement CCC PDF), envoyées avec la transmission au destinataire.
BEGIN;
CREATE TABLE dispatch_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  sheet_id uuid NOT NULL REFERENCES dispatch_sheets(id),
  kind text NOT NULL CHECK (kind IN ('fiche','connaissement_ccc')),
  filename text NOT NULL, mime text NOT NULL, size_bytes integer NOT NULL, sha256 text NOT NULL, content bytea NOT NULL,
  uploaded_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sheet_id, kind)
);
CREATE TRIGGER dispatch_attachments_immutable BEFORE UPDATE OR DELETE ON dispatch_attachments FOR EACH ROW EXECUTE FUNCTION forbid_change();
ALTER TABLE dispatch_attachments ENABLE ROW LEVEL SECURITY; ALTER TABLE dispatch_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON dispatch_attachments USING (organization_id::text = current_setting('app.current_org', true)) WITH CHECK (organization_id::text = current_setting('app.current_org', true));
-- le destinataire du chargement lit les pièces de la fiche transmise (livraison créée chez lui)
CREATE POLICY receiver_read ON dispatch_attachments FOR SELECT USING (EXISTS (SELECT 1 FROM deliveries d WHERE d.source_sheet_id = dispatch_attachments.sheet_id AND d.organization_id::text = current_setting('app.current_org', true)));
COMMIT;
