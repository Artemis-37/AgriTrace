-- Transport, expéditions, acheteurs, contrats, commandes, factures, paiements reçus, réclamations (CDC §17, §18).
BEGIN;

-- Types de mouvements de stock supplémentaires (CDC §15.2)
ALTER TABLE warehouse_movements DROP CONSTRAINT warehouse_movements_movement_type_check;
ALTER TABLE warehouse_movements ADD CONSTRAINT warehouse_movements_movement_type_check CHECK (movement_type IN
  ('reception','entry','exit','transfer_in','transfer_out','loss','adjustment_in','adjustment_out','split_in','split_out','merge_in','merge_out',
   'loading','return','deterioration','downgrade','quarantine_in','quarantine_out'));

CREATE TABLE carriers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  code text NOT NULL, name text NOT NULL, phone text, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  UNIQUE (organization_id, code)
);
CREATE TABLE vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  carrier_id uuid REFERENCES carriers(id),
  plate text NOT NULL, kind text, capacity_kg numeric(18,3) CHECK (capacity_kg IS NULL OR capacity_kg > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  UNIQUE (organization_id, plate)
);
CREATE TABLE drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  carrier_id uuid REFERENCES carriers(id),
  full_name text NOT NULL, phone text, licence_no text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL
);

CREATE TABLE buyers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  code text NOT NULL, name text NOT NULL, contact_name text, phone text, email text, country text, address text, tax_id text,
  currency text NOT NULL DEFAULT 'XOF', payment_terms_days integer NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 365),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  UNIQUE (organization_id, code)
);

CREATE TABLE sales_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  number text NOT NULL, buyer_id uuid NOT NULL REFERENCES buyers(id), value_chain_id uuid REFERENCES value_chains(id),
  starts_on date NOT NULL, ends_on date NOT NULL CHECK (ends_on >= starts_on),
  quantity_kg numeric(18,3) CHECK (quantity_kg IS NULL OR quantity_kg > 0),
  unit_price numeric(18,4) CHECK (unit_price IS NULL OR unit_price >= 0), currency text NOT NULL,
  payment_terms_days integer NOT NULL DEFAULT 30,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','expired','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  UNIQUE (organization_id, number)
);

CREATE TABLE sales_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key text NOT NULL, number text NOT NULL,
  buyer_id uuid NOT NULL REFERENCES buyers(id), contract_id uuid REFERENCES sales_contracts(id),
  value_chain_id uuid NOT NULL REFERENCES value_chains(id), campaign_id uuid REFERENCES campaigns(id),
  currency text NOT NULL, payment_terms_days integer NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','partially_shipped','shipped','delivered','closed','cancelled')),
  notes text, cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, idempotency_key), UNIQUE (organization_id, number)
);
CREATE TABLE sales_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  order_id uuid NOT NULL REFERENCES sales_orders(id),
  description text, quantity_kg numeric(18,3) NOT NULL CHECK (quantity_kg > 0),
  unit_price numeric(18,4) NOT NULL CHECK (unit_price >= 0)
);
-- Lots affectés (réservation) : le stock réservé n'est plus proposé à une autre commande
CREATE TABLE order_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  order_id uuid NOT NULL REFERENCES sales_orders(id),
  line_id uuid NOT NULL REFERENCES sales_order_lines(id),
  lot_id uuid NOT NULL REFERENCES lots(id), warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  quantity_kg numeric(18,3) NOT NULL CHECK (quantity_kg > 0),
  loaded_kg numeric(18,3) NOT NULL DEFAULT 0 CHECK (loaded_kg >= 0),
  released boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  CHECK (loaded_kg <= quantity_kg)
);
CREATE INDEX idx_alloc_lot ON order_allocations (lot_id, warehouse_id) WHERE NOT released;

CREATE TABLE shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key text NOT NULL, reference text NOT NULL,
  order_id uuid REFERENCES sales_orders(id),
  carrier_id uuid REFERENCES carriers(id), vehicle_id uuid REFERENCES vehicles(id), driver_id uuid REFERENCES drivers(id),
  origin_warehouse_id uuid NOT NULL REFERENCES warehouses(id), destination text NOT NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','loaded','in_transit','delivered','validated','cancelled')),
  seals text[] NOT NULL DEFAULT '{}', transport_doc_no text,
  planned_departure timestamptz, departed_at timestamptz, arrived_at timestamptz,
  received_by_name text, validated_by uuid, validated_at timestamptz, validation_note text, cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, idempotency_key), UNIQUE (organization_id, reference)
);
CREATE TABLE shipment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  shipment_id uuid NOT NULL REFERENCES shipments(id),
  allocation_id uuid REFERENCES order_allocations(id),
  lot_id uuid NOT NULL REFERENCES lots(id), warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  planned_kg numeric(18,3) NOT NULL CHECK (planned_kg > 0),
  loaded_kg numeric(18,3) CHECK (loaded_kg IS NULL OR loaded_kg >= 0),
  delivered_kg numeric(18,3) CHECK (delivered_kg IS NULL OR delivered_kg >= 0),
  invoiced_kg numeric(18,3) NOT NULL DEFAULT 0,
  discrepancy_reason text, discrepancy_handler uuid,
  loading_movement_id uuid REFERENCES warehouse_movements(id)
);
CREATE INDEX idx_ship_items_lot ON shipment_items (lot_id);
CREATE TABLE shipment_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  shipment_id uuid NOT NULL REFERENCES shipments(id),
  kind text NOT NULL CHECK (kind IN ('delay','damage','loss','accident','seal_broken','other')),
  description text NOT NULL, quantity_kg numeric(18,3),
  handler_id uuid, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')), resolution text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL, resolved_at timestamptz
);

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key text NOT NULL, number text NOT NULL,
  order_id uuid NOT NULL REFERENCES sales_orders(id), buyer_id uuid NOT NULL REFERENCES buyers(id),
  currency text NOT NULL, issue_date date NOT NULL, due_date date NOT NULL,
  total numeric(18,2) NOT NULL CHECK (total >= 0),
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','partially_paid','paid','cancelled')),
  cancel_reason text, cancelled_by uuid, cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  UNIQUE (organization_id, idempotency_key), UNIQUE (organization_id, number)
);
CREATE TABLE invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  shipment_item_id uuid NOT NULL REFERENCES shipment_items(id), lot_id uuid NOT NULL REFERENCES lots(id),
  quantity_kg numeric(18,3) NOT NULL CHECK (quantity_kg > 0), unit_price numeric(18,4) NOT NULL, amount numeric(18,2) NOT NULL
);
CREATE TABLE invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key text NOT NULL,
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  amount numeric(18,2) NOT NULL CHECK (amount > 0), received_on date NOT NULL,
  method text NOT NULL CHECK (method IN ('cash','bank_transfer','mobile_money','cheque','other')), reference text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  UNIQUE (organization_id, idempotency_key)
);
CREATE TABLE sales_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  buyer_id uuid NOT NULL REFERENCES buyers(id),
  order_id uuid REFERENCES sales_orders(id), shipment_id uuid REFERENCES shipments(id), invoice_id uuid REFERENCES invoices(id),
  description text NOT NULL, amount_claimed numeric(18,2),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','rejected')), resolution text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL, resolved_at timestamptz, resolved_by uuid
);

CREATE TRIGGER trg_invoice_lines_immutable BEFORE UPDATE OR DELETE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER trg_invoice_payments_immutable BEFORE UPDATE OR DELETE ON invoice_payments FOR EACH ROW EXECUTE FUNCTION forbid_change();

ALTER TABLE documents DROP CONSTRAINT documents_subject_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_subject_type_check CHECK (subject_type IN
  ('producer','collector','declaration','lot','receipt','payment','inspection','certificate','loan','parcel','task','shipment','order','invoice','claim'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['carriers','vehicles','drivers','buyers','sales_contracts','sales_orders','sales_order_lines','order_allocations','shipments','shipment_items',
                           'shipment_incidents','invoices','invoice_lines','invoice_payments','sales_claims'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I
      USING (organization_id::text = current_setting('app.current_org', true))
      WITH CHECK (organization_id::text = current_setting('app.current_org', true))$p$, t);
  END LOOP;
END $$;

INSERT INTO permissions(code, description) VALUES
 ('logistics:manage','Gérer transporteurs, véhicules et conducteurs'),
 ('logistics:read','Consulter transporteurs, véhicules, conducteurs et expéditions'),
 ('shipments:manage','Planifier, charger et suivre les expéditions'),
 ('shipments:validate','Valider la livraison d''une expédition'),
 ('buyers:manage','Gérer les fiches acheteurs et les contrats'),
 ('buyers:read','Consulter les acheteurs, contrats et commandes'),
 ('orders:manage','Créer, confirmer et annuler des commandes, affecter des lots'),
 ('invoices:issue','Émettre et annuler des factures'),
 ('invoices:read','Consulter les factures et soldes'),
 ('invoices:payments','Enregistrer les paiements reçus'),
 ('claims:manage','Enregistrer et traiter les réclamations des acheteurs');
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
   WHERE r.code = 'coop_admin' AND p.code IN ('logistics:manage','logistics:read','shipments:manage','shipments:validate','buyers:manage','buyers:read','orders:manage','invoices:issue','invoices:read','invoices:payments','claims:manage')
  ON CONFLICT DO NOTHING;
COMMIT;
