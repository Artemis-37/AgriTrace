-- 064 : refoulement d'un chargement par l'exportateur. Le volume revient dans le stock de la coopérative et ses convois redeviennent disponibles pour un autre chargement.
BEGIN;
ALTER TABLE dispatch_sheets ADD COLUMN returned_at timestamptz, ADD COLUMN returned_by uuid, ADD COLUMN return_reason text;

CREATE OR REPLACE FUNCTION dispatch_sheets_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Une fiche d''accompagnement ne se supprime pas'; END IF;
  IF OLD.status = 'transmitted' THEN
    -- seul le refoulement (retour du volume en stock) peut encore être inscrit sur une fiche transmise
    IF OLD.returned_at IS NULL AND NEW.returned_at IS NOT NULL
       AND (to_jsonb(NEW) - 'returned_at' - 'returned_by' - 'return_reason') = (to_jsonb(OLD) - 'returned_at' - 'returned_by' - 'return_reason') THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Une fiche transmise à l''exportateur ne peut plus être modifiée';
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE deliveries DROP CONSTRAINT deliveries_status_check;
ALTER TABLE deliveries ADD CONSTRAINT deliveries_status_check CHECK (status IN ('arrived','weighing_in','weighed','analysed','settled','refused'));
ALTER TABLE deliveries ADD COLUMN refused_at timestamptz, ADD COLUMN refused_by uuid, ADD COLUMN refusal_reason text;

CREATE OR REPLACE FUNCTION deliveries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Une livraison ne se supprime pas'; END IF;
  IF OLD.status = 'refused' THEN RAISE EXCEPTION 'Un chargement refoulé ne change plus'; END IF;
  IF OLD.status IN ('analysed','settled') AND (NEW.gross_kg IS DISTINCT FROM OLD.gross_kg OR NEW.tare_kg IS DISTINCT FROM OLD.tare_kg OR NEW.net_kg IS DISTINCT FROM OLD.net_kg
      OR NEW.net_delivered_kg IS DISTINCT FROM OLD.net_delivered_kg OR NEW.sack_tare_kg IS DISTINCT FROM OLD.sack_tare_kg OR NEW.bags_discharged IS DISTINCT FROM OLD.bags_discharged) THEN
    RAISE EXCEPTION 'Les poids d''une livraison analysée ne peuvent plus être modifiés'; END IF;
  IF OLD.status = 'settled' THEN RAISE EXCEPTION 'Une livraison réglée ne peut plus être modifiée'; END IF;
  RETURN NEW;
END $$;

INSERT INTO permissions(code, description) VALUES ('deliveries:refuse','Refouler un chargement : le volume retourne dans le stock de la coopérative fournisseuse');
INSERT INTO role_permissions(role_id, permission_code) SELECT id, 'deliveries:refuse' FROM roles WHERE code = 'coop_admin' ON CONFLICT DO NOTHING;
COMMIT;
