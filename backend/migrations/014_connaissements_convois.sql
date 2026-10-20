-- 014 : connaissement (B/L) des expéditions vers le port + convois de collecteurs, réception au magasin central, traitement en caisse.
BEGIN;

-- 1. Expéditions vers l'exportateur : numéro de connaissement saisi, obligatoire dès le départ.
ALTER TABLE shipments
  ADD COLUMN bill_of_lading_no text CHECK (bill_of_lading_no IS NULL OR length(btrim(bill_of_lading_no)) BETWEEN 3 AND 60),
  ADD COLUMN port text,
  ADD COLUMN exporter_name text;
-- NOT VALID : les expéditions déjà parties avant cette migration restent intactes ; toute nouvelle sortie est contrôlée.
ALTER TABLE shipments ADD CONSTRAINT shipments_bl_required
  CHECK (status IN ('planned','loaded','cancelled') OR bill_of_lading_no IS NOT NULL) NOT VALID;

-- 2. Convois : le collecteur (délégué) achète chez les producteurs puis convoie vers le magasin central.
CREATE TABLE convoys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key text NOT NULL,
  convoy_no text NOT NULL CHECK (length(btrim(convoy_no)) BETWEEN 2 AND 60),
  collector_id uuid NOT NULL REFERENCES collectors(id),
  driver_name text NOT NULL CHECK (length(btrim(driver_name)) >= 2),
  truck_no text NOT NULL CHECK (length(btrim(truck_no)) >= 2),
  declared_bags integer CHECK (declared_bags IS NULL OR declared_bags >= 0),
  declared_kg numeric(18,3) CHECK (declared_kg IS NULL OR declared_kg >= 0),
  notes text,
  status text NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit','received','settled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, convoy_no)
);

-- 3. Réception au magasin central (magasinier) puis traitement par la caisse.
CREATE TABLE convoy_receptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key text NOT NULL,
  convoy_id uuid NOT NULL UNIQUE REFERENCES convoys(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  total_kg numeric(18,3) NOT NULL CHECK (total_kg > 0),
  bags integer NOT NULL CHECK (bags > 0),
  variance_kg numeric(18,3),
  received_by uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  status text NOT NULL DEFAULT 'pending_cashier' CHECK (status IN ('pending_cashier','settled')),
  unit_price numeric(18,4),
  amount numeric(18,4),
  tx_id uuid REFERENCES financial_transactions(id),
  settled_by uuid,
  settled_at timestamptz,
  UNIQUE (organization_id, idempotency_key),
  CHECK (status = 'pending_cashier' OR (tx_id IS NOT NULL AND amount IS NOT NULL))
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['convoys','convoy_receptions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I
      USING (organization_id::text = current_setting('app.current_org', true))
      WITH CHECK (organization_id::text = current_setting('app.current_org', true))$p$, t);
  END LOOP;
END $$;

INSERT INTO permissions(code, description) VALUES
 ('convoys:create','Déclarer un convoi (collecteur : n° de convoi, chauffeur, camion)'),
 ('convoys:read','Consulter les convois'),
 ('convoys:receive','Réceptionner un convoi au magasin central (poids total, sacs)'),
 ('convoys:settle','Traiter un convoi en caisse et créditer le compte du collecteur');
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
   WHERE r.code = 'coop_admin' AND p.code LIKE 'convoys:%'
  ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, p FROM roles r CROSS JOIN unnest(ARRAY['convoys:create','convoys:read']) p WHERE r.code = 'collecteur'
  ON CONFLICT DO NOTHING;
COMMIT;
