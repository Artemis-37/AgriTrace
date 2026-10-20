-- Inventaire, notifications persistées, suspension/révocation d'accès, statuts producteur historisés, préfinancement reçu (CDC §6.2, §15.3, §20.3, §25, §27.7).
BEGIN;

-- Statuts producteur (CDC §6.2) + historique
ALTER TABLE producers DROP CONSTRAINT producers_status_check;
ALTER TABLE producers ADD CONSTRAINT producers_status_check CHECK (status IN ('creating','active','to_verify','suspended','inactive','left','archived'));
CREATE TABLE producer_status_history (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  producer_id uuid NOT NULL REFERENCES producers(id),
  from_status text, to_status text NOT NULL, reason text,
  actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_prod_status_hist ON producer_status_history (producer_id, id);
CREATE TRIGGER trg_prod_status_hist_immutable BEFORE UPDATE OR DELETE ON producer_status_history FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Événements d'accès (suspension, réactivation, changement de rôle, révocation de sessions)
CREATE TABLE user_access_events (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL CHECK (action IN ('suspend','reactivate','role_change','revoke_sessions')),
  reason text, details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_access_events_user ON user_access_events (organization_id, user_id, id);
CREATE TRIGGER trg_access_events_immutable BEFORE UPDATE OR DELETE ON user_access_events FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Notifications consultables dans l'historique
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  title text NOT NULL, body text,
  entity_type text, entity_id uuid,
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz,
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX idx_notifications_user ON notifications (user_id, organization_id, created_at DESC);

-- Inventaire : théorique / compté / écart / motif / compteur / approbateur
CREATE TABLE stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key text NOT NULL, number text NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  status text NOT NULL DEFAULT 'counting' CHECK (status IN ('counting','submitted','approved','rejected','cancelled')),
  opened_at timestamptz NOT NULL DEFAULT now(), opened_by uuid NOT NULL,
  submitted_at timestamptz, submitted_by uuid,
  decided_at timestamptz, decided_by uuid, decision_note text,
  UNIQUE (organization_id, idempotency_key), UNIQUE (organization_id, number)
);
CREATE UNIQUE INDEX uq_stock_count_open ON stock_counts (warehouse_id) WHERE status IN ('counting','submitted');
CREATE TABLE stock_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  count_id uuid NOT NULL REFERENCES stock_counts(id),
  lot_id uuid NOT NULL REFERENCES lots(id),
  theoretical_kg numeric(18,3) NOT NULL,            -- au moment de l'ouverture
  counted_kg numeric(18,3) CHECK (counted_kg IS NULL OR counted_kg >= 0),
  counted_by uuid, counted_at timestamptz,
  reason text,
  theoretical_at_approval_kg numeric(18,3),         -- solde au moment de l'approbation
  adjustment_movement_id uuid REFERENCES warehouse_movements(id),
  UNIQUE (count_id, lot_id)
);

-- Préfinancement reçu par la coopérative (CDC §20.3)
CREATE TABLE prefinancings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key text NOT NULL, number text NOT NULL,
  funder text NOT NULL, amount numeric(18,2) NOT NULL CHECK (amount > 0), currency text NOT NULL,
  received_on date NOT NULL, conditions text, campaign_id uuid REFERENCES campaigns(id),
  value_chain_id uuid REFERENCES value_chains(id), due_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','repaid','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  UNIQUE (organization_id, idempotency_key), UNIQUE (organization_id, number)
);
CREATE TABLE prefinancing_uses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key text NOT NULL,
  prefinancing_id uuid NOT NULL REFERENCES prefinancings(id),
  kind text NOT NULL CHECK (kind IN ('purchase','expense','advance','other')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0), used_on date NOT NULL, purpose text NOT NULL,
  declaration_id uuid REFERENCES purchase_declarations(id),
  document_ref text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  UNIQUE (organization_id, idempotency_key)
);
CREATE TABLE prefinancing_repayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key text NOT NULL,
  prefinancing_id uuid NOT NULL REFERENCES prefinancings(id),
  amount numeric(18,2) NOT NULL CHECK (amount > 0), paid_on date NOT NULL, reference text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  UNIQUE (organization_id, idempotency_key)
);
CREATE TRIGGER trg_prefin_uses_immutable BEFORE UPDATE OR DELETE ON prefinancing_uses FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER trg_prefin_rep_immutable BEFORE UPDATE OR DELETE ON prefinancing_repayments FOR EACH ROW EXECUTE FUNCTION forbid_change();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['producer_status_history','user_access_events','notifications','stock_counts','stock_count_lines','prefinancings','prefinancing_uses','prefinancing_repayments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I
      USING (organization_id::text = current_setting('app.current_org', true))
      WITH CHECK (organization_id::text = current_setting('app.current_org', true))$p$, t);
  END LOOP;
END $$;

INSERT INTO permissions(code, description) VALUES
 ('users:suspend','Suspendre, réactiver un compte et révoquer ses sessions'),
 ('users:change_role','Modifier le rôle d''un utilisateur'),
 ('producers:status','Changer le statut d''un producteur'),
 ('notifications:scan','Lancer la recherche d''alertes'),
 ('stock:count','Compter le stock (inventaire)'),
 ('stock:count_approve','Approuver un inventaire et ses ajustements'),
 ('prefinancing:manage','Enregistrer préfinancements, utilisations et remboursements'),
 ('prefinancing:read','Consulter les préfinancements');
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
   WHERE r.code = 'coop_admin' AND p.code IN ('users:suspend','users:change_role','producers:status','notifications:scan','stock:count','stock:count_approve','prefinancing:manage','prefinancing:read')
  ON CONFLICT DO NOTHING;
COMMIT;
