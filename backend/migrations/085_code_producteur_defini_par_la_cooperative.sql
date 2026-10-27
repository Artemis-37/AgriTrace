-- Le serveur n'attribue plus de code producteur de sa propre initiative : la coopérative définit son format
-- (préfixe, nombre de chiffres, premier numéro). Sans format défini, le code reste vide et se saisit à la main.
BEGIN;
ALTER TABLE org_settings
  ADD COLUMN producer_code_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN producer_code_prefix text NOT NULL DEFAULT '' CHECK (producer_code_prefix ~ '^[A-Za-z0-9_-]{0,12}$'),
  ADD COLUMN producer_code_digits integer NOT NULL DEFAULT 5 CHECK (producer_code_digits BETWEEN 1 AND 9),
  ADD COLUMN producer_code_start integer NOT NULL DEFAULT 1 CHECK (producer_code_start >= 1);

-- Un code vide est permis plusieurs fois ; un code renseigné reste unique dans la coopérative.
ALTER TABLE producers DROP CONSTRAINT producers_organization_id_internal_code_key;
CREATE UNIQUE INDEX uq_producers_internal_code ON producers (organization_id, internal_code) WHERE internal_code <> '';

-- Les coopératives qui utilisent déjà les codes P00001… gardent ce format (il devient leur choix explicite).
DO $$ DECLARE o record; BEGIN
  FOR o IN SELECT DISTINCT organization_id AS id FROM producers WHERE internal_code ~ '^P[0-9]+$' LOOP
    PERFORM set_config('app.current_org', o.id::text, true);
    INSERT INTO org_settings(organization_id, producer_code_enabled, producer_code_prefix, producer_code_digits)
    VALUES (o.id, true, 'P', 5)
    ON CONFLICT (organization_id) DO UPDATE SET producer_code_enabled = true, producer_code_prefix = 'P', producer_code_digits = 5;
  END LOOP;
END $$;
COMMIT;
