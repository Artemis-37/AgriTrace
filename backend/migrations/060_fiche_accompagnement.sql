-- Fiche d'accompagnement : liste des producteurs d'un chargement (un ou plusieurs connaissements/convois reçus) remise à l'exportateur.
-- Le responsable de traçabilité la prépare (ou importe une fiche déjà remplie), l'exporte en Excel puis la transmet à l'exportateur.
BEGIN;

CREATE TABLE dispatch_sheet_counters (
  organization_id uuid NOT NULL REFERENCES organizations(id), year integer NOT NULL, last_no integer NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, year)
);

CREATE TABLE dispatch_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  number text NOT NULL,
  source text NOT NULL DEFAULT 'generated' CHECK (source IN ('generated','imported')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','transmitted')),
  driver_name text, truck_no text, trailer_no text,
  declared_kg numeric(18,3) CHECK (declared_kg IS NULL OR declared_kg >= 0),
  declared_bags integer CHECK (declared_bags IS NULL OR declared_bags >= 0),
  lot_id_dse text, bl_no text, departure_date date,
  cocoa_type text NOT NULL DEFAULT 'ordinaire' CHECK (cocoa_type IN ('ordinaire','certifie')),
  certifications text[] NOT NULL DEFAULT '{}', other_certification text,
  coop_name text,
  adg_name text, warehouse_keeper_name text,
  lines jsonb NOT NULL DEFAULT '[]',          -- lignes figées à la création / à l'import (producteurs du chargement)
  file_name text, file_sha256 text, file_bytes bytea,   -- fichier d'origine d'une fiche importée (transmis tel quel)
  exporter_user_id uuid REFERENCES users(id), exporter_name text,
  transmitted_at timestamptz, transmitted_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL REFERENCES users(id),
  UNIQUE (organization_id, number)
);
CREATE INDEX dispatch_sheets_org ON dispatch_sheets (organization_id, created_at DESC);

CREATE TABLE dispatch_sheet_convoys (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  sheet_id uuid NOT NULL REFERENCES dispatch_sheets(id),
  convoy_id uuid NOT NULL REFERENCES convoys(id),
  PRIMARY KEY (sheet_id, convoy_id)
);

-- Une fiche transmise ne change plus ; avant, seules la transmission et le destinataire évoluent.
CREATE FUNCTION dispatch_sheets_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Une fiche d''accompagnement ne se supprime pas'; END IF;
  IF OLD.status = 'transmitted' THEN RAISE EXCEPTION 'Une fiche transmise à l''exportateur ne peut plus être modifiée'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dispatch_sheets_guard BEFORE UPDATE OR DELETE ON dispatch_sheets FOR EACH ROW EXECUTE FUNCTION dispatch_sheets_guard();
CREATE TRIGGER dispatch_sheet_convoys_immutable BEFORE UPDATE OR DELETE ON dispatch_sheet_convoys FOR EACH ROW EXECUTE FUNCTION forbid_change();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['dispatch_sheet_counters','dispatch_sheets','dispatch_sheet_convoys'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I USING (organization_id::text = current_setting('app.current_org', true)) WITH CHECK (organization_id::text = current_setting('app.current_org', true))$p$, t);
  END LOOP;
END $$;

INSERT INTO permissions(code, description) VALUES
 ('dispatch:manage','Fiches d''accompagnement : consulter les producteurs d''un convoi ou d''un chargement, exporter en Excel, importer une fiche et la transmettre à l''exportateur'),
 ('dispatch:read','Exportateur : consulter et télécharger les fiches d''accompagnement qui lui ont été transmises');
INSERT INTO role_permissions(role_id, permission_code) SELECT id, 'dispatch:manage' FROM roles WHERE code IN ('coop_admin','responsable_tracabilite') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code) SELECT id, 'dispatch:read' FROM roles WHERE code = 'exportateur' ON CONFLICT DO NOTHING;
COMMIT;
