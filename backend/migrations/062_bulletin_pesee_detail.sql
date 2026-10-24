-- 062 : bulletin de pesée détaillé (modèle de l'exportateur) : indication connaissement, pesée entrée/sortie avec ponts, analyse complète, livraison produit.
BEGIN;
ALTER TABLE deliveries
  ADD COLUMN declared_gross_kg numeric(18,3),
  ADD COLUMN origin text, ADD COLUMN transporter text,
  ADD COLUMN bridge_in text, ADD COLUMN bridge_out text,
  ADD COLUMN bags_discharged integer CHECK (bags_discharged IS NULL OR bags_discharged >= 0),
  ADD COLUMN bags_refused integer NOT NULL DEFAULT 0 CHECK (bags_refused >= 0),
  ADD COLUMN sack_tare_kg numeric(18,3) NOT NULL DEFAULT 0 CHECK (sack_tare_kg >= 0),
  ADD COLUMN pallet_tare_kg numeric(18,3) NOT NULL DEFAULT 0 CHECK (pallet_tare_kg >= 0),
  ADD COLUMN net_delivered_kg numeric(18,3),          -- poids net livré = (entrée − sortie) − tare des sacs − tare des palettes
  ADD COLUMN refaction_kg numeric(18,3) NOT NULL DEFAULT 0 CHECK (refaction_kg >= 0),
  ADD COLUMN net_payable_kg numeric(18,3),            -- poids net payé = net livré − réfaction (fixé à l'analyse)
  ADD COLUMN issuer jsonb;                            -- en-tête de l'exportateur figé à l'émission du bulletin (nom, adresse, téléphone, n° contribuable, campagne, usine)

CREATE OR REPLACE FUNCTION deliveries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Une livraison ne se supprime pas'; END IF;
  IF OLD.status IN ('analysed','settled') AND (NEW.gross_kg IS DISTINCT FROM OLD.gross_kg OR NEW.tare_kg IS DISTINCT FROM OLD.tare_kg OR NEW.net_kg IS DISTINCT FROM OLD.net_kg
      OR NEW.net_delivered_kg IS DISTINCT FROM OLD.net_delivered_kg OR NEW.sack_tare_kg IS DISTINCT FROM OLD.sack_tare_kg OR NEW.bags_discharged IS DISTINCT FROM OLD.bags_discharged) THEN
    RAISE EXCEPTION 'Les poids d''une livraison analysée ne peuvent plus être modifiés'; END IF;
  IF OLD.status = 'settled' AND NEW.status = 'settled' AND (NEW.amount IS DISTINCT FROM OLD.amount OR NEW.decision IS DISTINCT FROM OLD.decision OR NEW.net_payable_kg IS DISTINCT FROM OLD.net_payable_kg) THEN
    RAISE EXCEPTION 'Une livraison réglée ne peut plus être modifiée'; END IF;
  RETURN NEW;
END $$;
COMMIT;
