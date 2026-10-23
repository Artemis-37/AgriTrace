-- Type de prélèvement : nature de la retenue au kilo d'un délégué (fixée par l'administrateur avec les tarifs, permission collectors:rates).
ALTER TABLE collectors ADD COLUMN retention_type text NOT NULL DEFAULT 'mise_en_compte'
  CHECK (retention_type IN ('mise_en_compte','epargne','caution','cotisation'));
ALTER TABLE convoy_receptions ADD COLUMN retention_type text;
