-- La caisse ne se clôture pas (elle n'encaisse pas : bons de sortie, chèques, paiements en espèces) :
-- le caissier se connecte à la caisse et s'en déconnecte, sans fonds d'ouverture ni comptage. Seul le caissier a ce droit.
INSERT INTO permissions(code, description) VALUES ('cash:session', 'Se connecter à la caisse et s''en déconnecter (réservé au caissier)');
INSERT INTO role_permissions(role_id, permission_code) SELECT id, 'cash:session' FROM roles WHERE code = 'caissier';
