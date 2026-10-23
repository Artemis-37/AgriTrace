-- Mise en compte (retenues) des délégués : clôture du compte, puis reversement soumis à l'approbation de l'administrateur de la coopérative.
-- Destinations : sur le compte du délégué, par chèque, en espèces ou vers un autre compte.
BEGIN;
ALTER TABLE collectors ADD COLUMN account_closed_at timestamptz, ADD COLUMN account_closed_by uuid;

CREATE TABLE collector_release_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  collector_id uuid NOT NULL REFERENCES collectors(id),
  amount numeric(18,4) NOT NULL CHECK (amount > 0),
  mode text NOT NULL CHECK (mode IN ('account','cheque','cash','transfer')),
  target_account_id uuid REFERENCES financial_accounts(id),
  cash_session_id uuid REFERENCES cash_sessions(id),
  cheque_no text,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by uuid NOT NULL, requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid, decided_at timestamptz, decision_comment text,
  tx_id uuid, entry_number text
);
CREATE INDEX idx_release_req_org ON collector_release_requests(organization_id, status);
ALTER TABLE collector_release_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON collector_release_requests USING (organization_id::text = current_setting('app.current_org', true)) WITH CHECK (organization_id::text = current_setting('app.current_org', true));

INSERT INTO permissions(code, description) VALUES
 ('savings:read','Consulter la mise en compte (retenues) des délégués'),
 ('savings:request','Clôturer le compte d''un délégué et demander le reversement de sa mise en compte'),
 ('savings:approve','Approuver ou refuser le reversement de la mise en compte d''un délégué');
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, p FROM roles r, unnest(ARRAY['savings:read']) p WHERE r.code IN ('coop_admin','adg','caissier','comptable','direction','responsable_financier','auditeur') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, 'savings:request' FROM roles r WHERE r.code IN ('coop_admin','caissier','comptable','responsable_financier') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, 'savings:approve' FROM roles r WHERE r.code = 'coop_admin' ON CONFLICT DO NOTHING;
COMMIT;
