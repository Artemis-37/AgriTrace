-- Traites : une campagne est une traite, « grande » ou « petite », avec ses dates de début et de fin ; les prix des produits se fixent par traite.
BEGIN;
ALTER TABLE campaigns ADD COLUMN traite text CHECK (traite IS NULL OR traite IN ('grande','petite'));
COMMIT;
