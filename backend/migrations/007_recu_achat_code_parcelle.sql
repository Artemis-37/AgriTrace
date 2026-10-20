-- Reçu d'achat saisi dès la déclaration (CDC v1.0 §13.3-13.4), deux modes par série, corrections historisées ;
-- code de parcelle « CODE_PRODUCTEUR-Pn » (CDC §8.2) attribué sous verrou.
BEGIN;

ALTER TABLE org_settings
  ADD COLUMN purchase_receipt_mode text NOT NULL DEFAULT 'physical' CHECK (purchase_receipt_mode IN ('physical','generated')),
  ADD COLUMN purchase_receipt_series text NOT NULL DEFAULT 'A' CHECK (purchase_receipt_series ~ '^[A-Z0-9]{1,10}$'),
  ADD COLUMN purchase_receipt_required boolean NOT NULL DEFAULT true,
  -- masque simple : # = chiffre, A = lettre majuscule, autre caractère = littéral (pas d'expression régulière libre)
  ADD COLUMN purchase_receipt_mask text CHECK (purchase_receipt_mask IS NULL OR length(purchase_receipt_mask) <= 40),
  ADD COLUMN purchase_receipt_prefix text NOT NULL DEFAULT 'RA' CHECK (purchase_receipt_prefix ~ '^[A-Z0-9-]{1,10}$');

-- Une série ne mélange jamais les deux modes : le mode utilisé par chaque série est consigné.
CREATE TABLE purchase_receipt_series (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  series text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('physical','generated')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  PRIMARY KEY (organization_id, series)
);

ALTER TABLE purchase_declarations
  ADD COLUMN purchase_receipt_series text,
  ADD COLUMN purchase_receipt_no text,
  ADD COLUMN purchase_receipt_entered text,           -- valeur originale saisie, jamais modifiée
  ADD COLUMN purchase_receipt_source text CHECK (purchase_receipt_source IN ('physical','generated')),
  ADD COLUMN receipt_conflict_with uuid REFERENCES purchase_declarations(id),
  ADD COLUMN receipt_override_by uuid,
  ADD COLUMN receipt_override_reason text;

-- Unicité par série ; un doublon (conflit ou exception autorisée) est stocké mais hors de l'index.
CREATE UNIQUE INDEX uq_decl_purchase_receipt ON purchase_declarations (organization_id, purchase_receipt_series, purchase_receipt_no)
  WHERE purchase_receipt_no IS NOT NULL AND receipt_conflict_with IS NULL;
CREATE INDEX idx_decl_purchase_receipt_no ON purchase_declarations (organization_id, purchase_receipt_no);

CREATE TABLE purchase_receipt_corrections (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  declaration_id uuid NOT NULL REFERENCES purchase_declarations(id),
  kind text NOT NULL CHECK (kind IN ('correction','duplicate_exception')),
  old_series text, old_no text, new_series text, new_no text,
  reason text NOT NULL,
  actor_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_receipt_corrections_immutable BEFORE UPDATE OR DELETE ON purchase_receipt_corrections
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Parcelles : compteur par producteur (jamais réattribué, même après archivage)
ALTER TABLE producers ADD COLUMN parcel_seq integer NOT NULL DEFAULT 0;
UPDATE producers p SET parcel_seq = (SELECT count(*) FROM parcels x WHERE x.producer_id = p.id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_receipt_series','purchase_receipt_corrections'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY org_isolation ON %I
      USING (organization_id::text = current_setting('app.current_org', true))
      WITH CHECK (organization_id::text = current_setting('app.current_org', true))$p$, t);
  END LOOP;
END $$;

INSERT INTO permissions(code, description) VALUES
 ('settings:receipts','Configurer la numérotation des reçus d''achat'),
 ('receipts:correct','Corriger un numéro de reçu d''achat'),
 ('receipts:override','Autoriser un numéro de reçu en doublon (exception auditée)'),
 ('receipts:search','Rechercher une opération par numéro de reçu');
INSERT INTO role_permissions(role_id, permission_code)
  SELECT r.id, p.code FROM roles r CROSS JOIN permissions p WHERE r.code = 'coop_admin' ON CONFLICT DO NOTHING;
COMMIT;
