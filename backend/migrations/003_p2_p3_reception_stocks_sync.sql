-- AgriTrace P3 (pesée, réception, stocks, lots) + P2 (synchronisation serveur)
BEGIN;

ALTER TABLE unit_conversions ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE org_settings (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id),
  weighing_variance_pct numeric(6,3) NOT NULL DEFAULT 2.000 CHECK (weighing_variance_pct >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid
);

CREATE TABLE document_counters (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  last_value integer NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, name)
);

CREATE TABLE warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  code text NOT NULL,
  value_chain_id uuid NOT NULL REFERENCES value_chains(id),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  kind text NOT NULL DEFAULT 'reception' CHECK (kind IN ('reception','split','merge')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE lot_relationships (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  parent_lot_id uuid NOT NULL REFERENCES lots(id),
  child_lot_id uuid NOT NULL REFERENCES lots(id),
  relation text NOT NULL CHECK (relation IN ('split','merge')),
  quantity_kg numeric(18,3) NOT NULL CHECK (quantity_kg > 0),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CHECK (parent_lot_id <> child_lot_id)
);
CREATE INDEX idx_lotrel_child ON lot_relationships(child_lot_id);
CREATE INDEX idx_lotrel_parent ON lot_relationships(parent_lot_id);

CREATE TABLE weighings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key text NOT NULL,
  declaration_id uuid NOT NULL REFERENCES purchase_declarations(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  operator_id uuid NOT NULL,
  weighed_at timestamptz NOT NULL DEFAULT now(),
  gross_kg numeric(18,3) NOT NULL CHECK (gross_kg > 0),
  tare_kg numeric(18,3) NOT NULL DEFAULT 0 CHECK (tare_kg >= 0),
  net_kg numeric(18,3) NOT NULL CHECK (net_kg > 0),
  bags integer CHECK (bags IS NULL OR bags >= 0),
  declared_kg numeric(18,3) NOT NULL,          -- poids déclaré conservé séparément du poids pesé
  variance_kg numeric(18,3) NOT NULL,
  variance_pct numeric(9,3),
  threshold_pct numeric(6,3) NOT NULL,
  justification text,
  notes text,
  status text NOT NULL DEFAULT 'recorded' CHECK (status IN ('pending_approval','recorded','received','rejected')),
  approved_by uuid, approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key),
  CHECK (net_kg = gross_kg - tare_kg)
);
CREATE INDEX idx_weighings_decl ON weighings(declaration_id);

CREATE TABLE receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  number text NOT NULL,
  weighing_id uuid NOT NULL UNIQUE REFERENCES weighings(id),
  declaration_id uuid NOT NULL REFERENCES purchase_declarations(id),
  lot_id uuid NOT NULL REFERENCES lots(id),
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  UNIQUE (organization_id, number)
);

CREATE TABLE warehouse_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  reference text NOT NULL,
  idempotency_key text NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  lot_id uuid NOT NULL REFERENCES lots(id),
  movement_type text NOT NULL CHECK (movement_type IN
    ('reception','entry','exit','transfer_in','transfer_out','loss','adjustment_in','adjustment_out','split_in','split_out','merge_in','merge_out')),
  direction text NOT NULL CHECK (direction IN ('in','out')),
  quantity_kg numeric(18,3) NOT NULL CHECK (quantity_kg > 0),
  reason text,
  source_type text, source_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, reference)
);
CREATE INDEX idx_mov_lot ON warehouse_movements(lot_id, warehouse_id);
CREATE TRIGGER trg_movements_immutable BEFORE UPDATE OR DELETE ON warehouse_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE lot_events (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  lot_id uuid NOT NULL REFERENCES lots(id),
  event_type text NOT NULL,
  quantity_kg numeric(18,3),
  ref_type text, ref_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid
);
CREATE INDEX idx_lotev_lot ON lot_events(lot_id, id);
CREATE TRIGGER trg_lot_events_immutable BEFORE UPDATE OR DELETE ON lot_events
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- P2 : opérations de synchronisation reçues des appareils (journal + idempotence)
CREATE TABLE sync_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  device_id uuid REFERENCES devices(id),
  idempotency_key text NOT NULL,
  op_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('received','accepted','rejected','to_correct','conflict','pending_validation')),
  result jsonb,
  error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX idx_sync_ops_user ON sync_operations(organization_id, user_id, processed_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_settings','document_counters','warehouses','lots','lot_relationships','weighings',
                           'receipts','warehouse_movements','lot_events','sync_operations']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I
      USING (organization_id::text = current_setting('app.current_org', true))
      WITH CHECK (organization_id::text = current_setting('app.current_org', true))$p$, t);
  END LOOP;
END $$;

INSERT INTO permissions(code, description) VALUES
 ('warehouses:read','Consulter les magasins et les stocks'),
 ('warehouses:manage','Gérer les magasins'),
 ('weighings:create','Enregistrer des pesées'),
 ('weighings:read','Consulter les pesées et reçus'),
 ('weighings:approve','Valider les écarts de pesée (utilisateur distinct de l''opérateur)'),
 ('receipts:create','Valider une réception et émettre le reçu'),
 ('stock:move','Enregistrer des mouvements de stock'),
 ('stock:adjust','Ajuster les stocks et déclarer des pertes'),
 ('lots:read','Consulter les lots et la traçabilité'),
 ('lots:manage','Diviser et fusionner des lots'),
 ('settings:weighing','Configurer les seuils d''écart de pesée'),
 ('sync:use','Utiliser la synchronisation mobile');

INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, p.code FROM roles r CROSS JOIN permissions p WHERE r.code = 'coop_admin'
  ON CONFLICT DO NOTHING;

COMMIT;
