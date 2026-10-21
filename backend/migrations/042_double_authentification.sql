-- Double authentification (TOTP, RFC 6238) et verrouillage par couple (compte, adresse) :
-- un tiers ne peut plus bloquer un utilisateur depuis une autre adresse en multipliant les mauvais essais.
BEGIN;
ALTER TABLE users
  ADD COLUMN totp_secret text,                          -- secret chiffré (AES-256-GCM), jamais en clair
  ADD COLUMN totp_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN totp_recovery text[] NOT NULL DEFAULT '{}', -- empreintes SHA-256 des codes de secours (usage unique)
  ADD COLUMN totp_last_step bigint;                      -- dernier pas de 30 s accepté (un code ne sert qu'une fois)

CREATE TABLE login_failures (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip text NOT NULL,
  failures int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ip)
);
COMMIT;
