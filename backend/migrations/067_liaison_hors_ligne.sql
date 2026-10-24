-- 067 : une liaison « hors ligne » capte les changements (file) mais n'envoie rien toute seule : le transfert se fait par fichier.
ALTER TABLE replication_link ADD COLUMN offline boolean NOT NULL DEFAULT false;
