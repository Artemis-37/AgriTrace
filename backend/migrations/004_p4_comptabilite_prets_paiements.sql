-- AgriTrace P4a : comptabilité (référentiel SYSCOHADA révisé), prêts et préfinancements, paiements, rapprochements.
-- Le plan comptable fourni est une BASE à faire valider par un comptable compétent (cahier des charges, §30).
BEGIN;

ALTER TABLE financial_accounts ADD COLUMN accounting_code text;

-- ---------- Comptabilité ----------
CREATE TABLE accounting_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  code text NOT NULL CHECK (code ~ '^[1-9][0-9]{1,7}$'),
  label text NOT NULL,
  class smallint GENERATED ALWAYS AS (substr(code, 1, 1)::smallint) STORED,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  code text NOT NULL CHECK (code ~ '^[A-Z]{2,4}$'),
  label text NOT NULL,
  UNIQUE (organization_id, code)
);

CREATE TABLE accounting_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  journal_id uuid NOT NULL REFERENCES journals(id),
  number text NOT NULL,
  entry_date date NOT NULL,
  label text NOT NULL,
  reference_type text, reference_id uuid,
  idempotency_key text NOT NULL,
  reversal_of uuid REFERENCES accounting_entries(id),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  UNIQUE (organization_id, number),
  UNIQUE (organization_id, idempotency_key)
);
CREATE UNIQUE INDEX uq_entry_one_reversal ON accounting_entries (reversal_of) WHERE reversal_of IS NOT NULL;
CREATE INDEX idx_entries_date ON accounting_entries (organization_id, entry_date);
CREATE INDEX idx_entries_ref ON accounting_entries (reference_type, reference_id);

CREATE TABLE accounting_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  entry_id uuid NOT NULL REFERENCES accounting_entries(id),
  line_no smallint NOT NULL,
  account_id uuid NOT NULL REFERENCES accounting_accounts(id),
  debit numeric(18,4) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(18,4) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  label text,
  CHECK ((debit = 0) <> (credit = 0)),
  UNIQUE (entry_id, line_no)
);
CREATE INDEX idx_lines_account ON accounting_lines (account_id);

CREATE TABLE accounting_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  closed_until date NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now(), closed_by uuid NOT NULL,
  note text
);

-- Une écriture doit être équilibrée (débit = crédit) et comporter au moins deux lignes
CREATE FUNCTION check_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric; c numeric; n int;
BEGIN
  SELECT coalesce(sum(debit),0), coalesce(sum(credit),0), count(*) INTO d, c, n FROM accounting_lines WHERE entry_id = NEW.entry_id;
  IF n < 2 OR d <> c THEN
    RAISE EXCEPTION 'Écriture déséquilibrée ou incomplète (débit %, crédit %, % ligne(s))', d, c, n USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER accounting_balance AFTER INSERT ON accounting_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_entry_balanced();

-- Pas d'écriture dans une période clôturée
CREATE FUNCTION check_period_open() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lim date;
BEGIN
  SELECT max(closed_until) INTO lim FROM accounting_closures WHERE organization_id = NEW.organization_id;
  IF lim IS NOT NULL AND NEW.entry_date <= lim THEN
    RAISE EXCEPTION 'Période clôturée jusqu''au %', lim USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_entry_period BEFORE INSERT ON accounting_entries FOR EACH ROW EXECUTE FUNCTION check_period_open();

CREATE TRIGGER trg_entries_immutable BEFORE UPDATE OR DELETE ON accounting_entries FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER trg_lines_immutable BEFORE UPDATE OR DELETE ON accounting_lines FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER trg_closures_immutable BEFORE UPDATE OR DELETE ON accounting_closures FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Plan comptable de base (SYSCOHADA révisé) et journaux, créés à la demande pour une organisation
CREATE FUNCTION accounting_seed(org uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO accounting_accounts(organization_id, code, label) VALUES
    (org,'101','Capital social'),
    (org,'106','Réserves'),
    (org,'110','Report à nouveau'),
    (org,'120','Résultat de l''exercice (excédent)'),
    (org,'271','Prêts et créances non commerciales'),
    (org,'274','Prêts au personnel'),
    (org,'401','Fournisseurs, dettes en compte'),
    (org,'409','Fournisseurs débiteurs (avances et acomptes versés)'),
    (org,'411','Clients'),
    (org,'421','Personnel, avances et acomptes'),
    (org,'445','État, TVA récupérable'),
    (org,'471','Comptes d''attente'),
    (org,'521','Banques locales'),
    (org,'571','Caisse'),
    (org,'585','Virements de fonds'),
    (org,'601','Achats de marchandises'),
    (org,'602','Achats de matières premières et fournitures liées'),
    (org,'605','Autres achats'),
    (org,'658','Charges diverses (écarts de caisse négatifs)'),
    (org,'671','Intérêts des emprunts'),
    (org,'701','Ventes de marchandises'),
    (org,'758','Produits divers (écarts de caisse positifs)')
  ON CONFLICT DO NOTHING;
  INSERT INTO journals(organization_id, code, label) VALUES
    (org,'ACH','Journal des achats'),
    (org,'CAI','Journal de caisse'),
    (org,'BQ','Journal de banque'),
    (org,'OD','Opérations diverses')
  ON CONFLICT DO NOTHING;
END $$;

-- ---------- Prêts, avances et préfinancements ----------
CREATE TABLE loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  kind text NOT NULL CHECK (kind IN ('prefinancing','advance','loan')),
  borrower_type text NOT NULL CHECK (borrower_type IN ('producer','collector')),
  borrower_id uuid NOT NULL,
  requested_amount numeric(18,4) NOT NULL CHECK (requested_amount > 0),
  approved_amount numeric(18,4) CHECK (approved_amount > 0),
  currency char(3) NOT NULL DEFAULT 'XOF',
  purpose text NOT NULL,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','in_analysis','approved','rejected','disbursed','repaid','cancelled')),
  idempotency_key text NOT NULL,
  source_account_id uuid REFERENCES financial_accounts(id),
  disbursement_tx_id uuid REFERENCES financial_transactions(id),
  disbursement_entry_id uuid REFERENCES accounting_entries(id),
  requested_at timestamptz NOT NULL DEFAULT now(), requested_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX idx_loans_borrower ON loans (borrower_type, borrower_id);

CREATE TABLE loan_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  loan_id uuid NOT NULL REFERENCES loans(id),
  decision text NOT NULL CHECK (decision IN ('request','analysis','approve','reject','cancel','disburse')),
  comment text,
  decided_by uuid NOT NULL, decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE loan_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  loan_id uuid NOT NULL REFERENCES loans(id),
  seq smallint NOT NULL, due_date date NOT NULL,
  amount numeric(18,4) NOT NULL CHECK (amount > 0),
  UNIQUE (loan_id, seq)
);
CREATE TABLE loan_repayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  loan_id uuid NOT NULL REFERENCES loans(id),
  idempotency_key text NOT NULL,
  amount numeric(18,4) NOT NULL CHECK (amount > 0),
  reversal_of uuid REFERENCES loan_repayments(id),
  tx_id uuid NOT NULL REFERENCES financial_transactions(id),
  entry_id uuid NOT NULL REFERENCES accounting_entries(id),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  UNIQUE (organization_id, idempotency_key)
);
CREATE UNIQUE INDEX uq_repay_one_reversal ON loan_repayments (reversal_of) WHERE reversal_of IS NOT NULL;
CREATE TRIGGER trg_loan_decisions_immutable BEFORE UPDATE OR DELETE ON loan_decisions FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER trg_loan_installments_immutable BEFORE UPDATE OR DELETE ON loan_installments FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER trg_loan_repayments_immutable BEFORE UPDATE OR DELETE ON loan_repayments FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- ---------- Paiements ----------
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key text NOT NULL,
  source_account_id uuid NOT NULL REFERENCES financial_accounts(id),
  payee_type text NOT NULL CHECK (payee_type IN ('producer','collector','other')),
  payee_id uuid, payee_label text,
  amount numeric(18,4) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL,
  method text NOT NULL CHECK (method IN ('cash','bank_transfer','mobile_money','cheque')),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','initiated','pending','confirmed','failed','cancelled','refunded')),
  -- Aucun connecteur bancaire / Mobile Money n'existe encore : seule la confirmation manuelle est possible.
  confirmation_source text CHECK (confirmation_source IN ('manual','provider')),
  confirmation_note text,
  external_ref text,
  reference_type text, reference_id uuid,
  tx_id uuid REFERENCES financial_transactions(id),
  entry_id uuid REFERENCES accounting_entries(id),
  cash_session_id uuid REFERENCES cash_sessions(id),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);
CREATE TABLE payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  payment_id uuid NOT NULL REFERENCES payments(id),
  from_status text, to_status text NOT NULL, note text,
  actor_id uuid NOT NULL, at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_payment_events_immutable BEFORE UPDATE OR DELETE ON payment_events FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- ---------- Rapprochements ----------
CREATE TABLE reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  account_id uuid NOT NULL REFERENCES financial_accounts(id),
  statement_date date NOT NULL,
  statement_balance numeric(18,4) NOT NULL,
  book_balance numeric(18,4) NOT NULL,
  difference numeric(18,4) NOT NULL,
  status text NOT NULL CHECK (status IN ('balanced','difference_explained')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL
);
CREATE TRIGGER trg_reconciliations_immutable BEFORE UPDATE OR DELETE ON reconciliations FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- RLS
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounting_accounts','journals','accounting_entries','accounting_lines','accounting_closures',
                           'loans','loan_decisions','loan_installments','loan_repayments','payments','payment_events','reconciliations']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I
      USING (organization_id::text = current_setting('app.current_org', true))
      WITH CHECK (organization_id::text = current_setting('app.current_org', true))$p$, t);
  END LOOP;
END $$;

INSERT INTO permissions(code, description) VALUES
 ('accounting:read','Consulter journaux, grand livre et balance'),
 ('accounting:post','Saisir des écritures comptables'),
 ('accounting:close','Clôturer une période comptable'),
 ('loans:read','Consulter prêts et préfinancements'),
 ('loans:request','Demander et analyser un prêt ou préfinancement'),
 ('loans:approve','Approuver ou rejeter (utilisateur distinct du demandeur)'),
 ('loans:disburse','Décaisser un prêt approuvé'),
 ('loans:repay','Enregistrer un remboursement'),
 ('payments:read','Consulter les paiements'),
 ('payments:manage','Préparer et suivre les paiements'),
 ('payments:confirm','Confirmer manuellement un paiement'),
 ('reconciliation:manage','Effectuer et consulter les rapprochements');

INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, p.code FROM roles r CROSS JOIN permissions p WHERE r.code = 'coop_admin'
  ON CONFLICT DO NOTHING;

COMMIT;
