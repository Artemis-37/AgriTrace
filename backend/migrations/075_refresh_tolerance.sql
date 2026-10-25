-- Deux requêtes qui expirent en même temps présentent le même jeton de renouvellement : la seconde ne doit pas être prise pour un vol de session.
-- On garde l'empreinte du jeton précédent et la date de rotation : réutilisation tolérée pendant quelques secondes seulement.
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS prev_refresh_token_hash text, ADD COLUMN IF NOT EXISTS rotated_at timestamptz;
