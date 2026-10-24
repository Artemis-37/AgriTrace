-- 061 : exportateurs (organisation à part entière), liens entre organisations, livraisons reçues (pont bascule, analyse, bulletin de pesée).
BEGIN;

ALTER TABLE organizations ADD COLUMN kind text NOT NULL DEFAULT 'cooperative' CHECK (kind IN ('cooperative','exporter'));

-- Lien d'approvisionnement : from = fournisseur (livre), to = destinataire (reçoit). bidirectional = chacun peut livrer à l'autre.
-- Proposé par l'une des deux organisations, actif quand l'autre l'accepte.
CREATE TABLE org_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_org_id uuid NOT NULL REFERENCES organizations(id),
  to_org_id uuid NOT NULL REFERENCES organizations(id),
  bidirectional boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked')),
  requested_by_org uuid NOT NULL REFERENCES organizations(id),
  requested_by uuid NOT NULL,
  accepted_by uuid, accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_org_id <> to_org_id), CHECK (requested_by_org IN (from_org_id, to_org_id)),
  UNIQUE (from_org_id, to_org_id)
);

CREATE TABLE delivery_counters (
  organization_id uuid NOT NULL REFERENCES organizations(id), year int NOT NULL, last_no int NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, year)
);

-- Livraison reçue (côté destinataire) : naît de la transmission d'une fiche d'accompagnement.
CREATE TABLE deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),           -- destinataire
  source_org_id uuid NOT NULL REFERENCES organizations(id),             -- fournisseur
  source_org_name text NOT NULL,
  source_sheet_id uuid NOT NULL,
  source_sheet_no text NOT NULL,
  number text NOT NULL,
  driver_name text, truck_no text, trailer_no text,
  declared_kg numeric(18,3) NOT NULL DEFAULT 0, declared_bags integer NOT NULL DEFAULT 0,
  lot_id_dse text, bl_no text, departure_date date,
  cocoa_type text, certifications text[] NOT NULL DEFAULT '{}',
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'arrived' CHECK (status IN ('arrived','weighing_in','weighed','analysed','settled')),
  -- pont bascule
  gross_kg numeric(18,3) CHECK (gross_kg IS NULL OR gross_kg > 0), gross_at timestamptz, gross_by uuid,
  tare_kg numeric(18,3) CHECK (tare_kg IS NULL OR tare_kg >= 0), tare_at timestamptz, tare_by uuid,
  net_kg numeric(18,3), bags_counted integer CHECK (bags_counted IS NULL OR bags_counted >= 0),
  variance_kg numeric(18,3), variance_pct numeric(9,3),
  -- analyse
  moisture_pct numeric(5,2), bean_count integer, defects jsonb, grade text, decision text CHECK (decision IN ('accepted','rejected')),
  analysis_notes text, analysed_by uuid, analysed_at timestamptz, bulletin_no text,
  -- règlement du fournisseur
  unit_price numeric(18,4), amount numeric(18,4), settled_by uuid, settled_at timestamptz, payment_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number), UNIQUE (organization_id, source_org_id, source_sheet_id),
  CHECK (net_kg IS NULL OR (gross_kg IS NOT NULL AND tare_kg IS NOT NULL AND net_kg = gross_kg - tare_kg)),
  CHECK (tare_kg IS NULL OR gross_kg IS NULL OR tare_kg < gross_kg)
);
CREATE INDEX idx_deliveries_source ON deliveries(source_org_id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['org_links','delivery_counters','deliveries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
-- org_links : visible et modifiable par les deux organisations ; création par l'une des deux
CREATE POLICY link_parties ON org_links
  USING (from_org_id::text = current_setting('app.current_org', true) OR to_org_id::text = current_setting('app.current_org', true))
  WITH CHECK (from_org_id::text = current_setting('app.current_org', true) OR to_org_id::text = current_setting('app.current_org', true));
CREATE POLICY org_isolation ON delivery_counters USING (organization_id::text = current_setting('app.current_org', true)) WITH CHECK (organization_id::text = current_setting('app.current_org', true));
-- livraisons : le destinataire gère ; le fournisseur lit (suivi de ce qu'il a livré)
CREATE POLICY org_isolation ON deliveries USING (organization_id::text = current_setting('app.current_org', true)) WITH CHECK (organization_id::text = current_setting('app.current_org', true));
CREATE POLICY supplier_read ON deliveries FOR SELECT USING (source_org_id::text = current_setting('app.current_org', true));

-- Une livraison pesée ne change plus de poids ; aucune suppression.
CREATE FUNCTION deliveries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Une livraison ne se supprime pas'; END IF;
  IF OLD.status IN ('analysed','settled') AND (NEW.gross_kg IS DISTINCT FROM OLD.gross_kg OR NEW.tare_kg IS DISTINCT FROM OLD.tare_kg OR NEW.net_kg IS DISTINCT FROM OLD.net_kg) THEN
    RAISE EXCEPTION 'Les poids d''une livraison analysée ne peuvent plus être modifiés'; END IF;
  IF OLD.status = 'settled' AND NEW.status = 'settled' AND (NEW.amount IS DISTINCT FROM OLD.amount OR NEW.decision IS DISTINCT FROM OLD.decision) THEN
    RAISE EXCEPTION 'Une livraison réglée ne peut plus être modifiée'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deliveries_guard BEFORE UPDATE OR DELETE ON deliveries FOR EACH ROW EXECUTE FUNCTION deliveries_guard();

-- Destination d'une fiche : une organisation liée (en plus du destinataire interne historique)
ALTER TABLE dispatch_sheets ADD COLUMN destination_org_id uuid REFERENCES organizations(id);

INSERT INTO permissions(code, description) VALUES
 ('links:manage','Liens avec les autres organisations (exportateurs, coopératives) : proposer, accepter, révoquer'),
 ('deliveries:read','Livraisons reçues et livraisons envoyées : consulter'),
 ('deliveries:weigh','Pont bascule : peser l''entrée (brut) et la sortie (tare) d''une livraison, poids net'),
 ('deliveries:analyse','Analyse : saisir les résultats, décider, produire le bulletin de pesée'),
 ('deliveries:settle','Fixer le prix et régler la coopérative fournisseuse');
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, p FROM roles r, unnest(ARRAY['links:manage','deliveries:read','deliveries:weigh','deliveries:analyse','deliveries:settle']) p WHERE r.code = 'coop_admin' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, p FROM roles r, unnest(ARRAY['deliveries:read']) p WHERE r.code IN ('responsable_tracabilite','direction','caissier','comptable') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code) SELECT id, 'deliveries:settle' FROM roles WHERE code IN ('caissier','comptable') ON CONFLICT DO NOTHING;
COMMIT;
