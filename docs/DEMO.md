# Version de démonstration AgriTrace

Coopérative **fictive** avec des données d'exemple et **un compte par profil**, pour la formation, les présentations et les essais. Les noms, montants, coordonnées et le relevé bancaire sont inventés.

> **Ne jamais installer cette démonstration sur le serveur de production**, ni réutiliser son mot de passe. Les comptes sont publics par construction.

## Ce que contient la démonstration

| Domaine | Données d'exemple |
|---|---|
| Coopérative | « Coopérative Agricole de Démonstration », logo, adresse, devise XOF |
| Filière / campagne | Cacao, campagne 2026-2027, prix de 1 000 F/kg, conversion 1 sac = 65 kg |
| Producteurs / parcelles | 15 producteurs (3 villages), 10 parcelles tracées, 1 parcelle sans tracé |
| Achats | 12 déclarations (9 réceptionnées avec reçu et lot, 3 à valider) |
| Convois | 3 convois numérotés automatiquement (code CCC fictif `SC000000`, ex. `SC000000-2026-BRA-1`) : le 1er réglé, le 2e reçu en caisse, le 3e en route |
| Caisse / comptabilité | Caisse principale ouverte, entrées/sorties, 2 écritures manuelles, relevé bancaire CSV importé |
| Prêts | 1 demande en attente, 1 prêt approuvé avec échéancier |
| Qualité | Règle d'humidité, inspection conforme, certificat expirant sous 30 jours |
| Ventes | 1 acheteur fictif, 1 contrat, 1 commande |
| Terrain | 3 missions publiées, 2 relevés (formation, infrastructure sociale) |
| Contrôle | 1 demande d'annulation en attente (réception du 2e convoi) |
| Automatisation | 1 rapport Finances programmé chaque lundi |

## Installation

1. Démarrez AgriTrace normalement (API + base). Créez l'administrateur de plateforme :

   ```bash
   cd backend
   ADMIN_PASSWORD='<mot de passe de 12 caractères ou plus>' node scripts/create-platform-admin.js admin@exemple.test "Admin plateforme"
   ```

2. Chargez la démonstration :

   ```bash
   API=http://localhost:3000/v1 \
   ADMIN_EMAIL=admin@exemple.test ADMIN_PASSWORD='<le même>' \
   node scripts/seed-demo-complet.js
   ```

   Variables facultatives : `DEMO_PASSWORD` (12 caractères minimum, défaut documenté dans `COMPTES_DEMO.md`), `DEMO_DOMAIN` (défaut `demo.agritrace.test`), `DEMO_CODE`.

3. Ouvrez le portail et connectez-vous avec un compte de `docs/COMPTES_DEMO.md`.

Le script peut être relancé : il crée **une nouvelle** coopérative de démonstration à chaque exécution (les identifiants étant uniques par base, relancez-le sur une base vierge pour retrouver exactement les mêmes comptes).

## Réinitialiser

Pour repartir de zéro, recréez la base de démonstration (ou utilisez une base dédiée) puis relancez le script. Une démonstration ne doit jamais partager sa base avec des données réelles.

## Accès par partie

| Partie du portail | Comptes qui y accèdent |
|---|---|
| Tableau de bord, Messages, Notifications | tous |
| Producteurs | administrateur, agent de terrain, coach, responsable traçabilité, direction, auditeur |
| Parcelles / Cartographie | administrateur, responsable cartographie, cartographe, ADG, direction (lecture), auditeur (lecture) |
| Déclarations d'achat | administrateur, responsable traçabilité, collecteur (les siennes), direction, auditeur |
| Convois | administrateur, magasinier, caissier, responsable magasin, responsable logistique (lecture), collecteur (les siens) |
| Stocks et lots / Inventaire | administrateur, magasinier, responsable magasin, responsable traçabilité, qualité, direction |
| Caisse et comptabilité / Finances | administrateur, caissier, comptable, responsable financier, direction (lecture), auditeur (lecture) |
| Préfinancement | administrateur, responsable financier, direction (approbation) |
| Qualité et certificats | administrateur, responsable qualité, ADG, direction, auditeur |
| Commerce | administrateur, responsable logistique, acheteur (ses commandes) |
| Missions / Relevés de terrain | administrateur, ADG, agent de terrain, coach, direction |
| Rapports et envoi automatique | administrateur, direction, responsable financier, comptable, ADG, auditeur |
| Équipe | administrateur |
| Mes opérations | administrateur, magasinier, caissier, comptable, responsables (demande) ; direction et responsable financier (décision) |

Le détail exact figure dans `MATRICE_ROLES.md` ; en cas de différence, la matrice fait foi.
