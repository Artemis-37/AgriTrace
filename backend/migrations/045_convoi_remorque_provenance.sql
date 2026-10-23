-- Remorque et provenance déclarées par le collecteur avec le convoi : reprises automatiquement à la réception (modifiables par le magasinier).
BEGIN;
ALTER TABLE convoys ADD COLUMN trailer_no text, ADD COLUMN origin text;
COMMIT;
