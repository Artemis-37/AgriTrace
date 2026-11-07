-- À exécuter UNE FOIS dans l'éditeur SQL de Supabase (rôle postgres), avant la première migration.
-- Crée le rôle applicatif NON propriétaire et SANS contournement de la sécurité par ligne (RLS).
-- Remplacer MOT_DE_PASSE_APP par un mot de passe long et aléatoire.
CREATE ROLE agritrace_app LOGIN PASSWORD 'MOT_DE_PASSE_APP' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT ON DATABASE postgres TO agritrace_app;
GRANT USAGE ON SCHEMA public TO agritrace_app;
-- Permet au rôle postgres de gérer les objets créés pour agritrace_app (exigé par Supabase).
GRANT agritrace_app TO postgres;

-- Droits automatiques sur les futures tables créées par les migrations (exécutées par postgres).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO agritrace_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO agritrace_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO agritrace_app;

-- Fermer l'API de données de Supabase (PostgREST) : AgriTrace n'est accessible que par son propre serveur.
-- Par défaut Supabase donne aux rôles anon et authenticated tous les droits sur les nouvelles tables.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
