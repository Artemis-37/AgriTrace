// Génère docs/GUIDE_FORMATION.md à partir des modèles de rôles (backend/dist), des captures par profil
// (docs/captures/formation/index.json) et du contenu pédagogique ci-dessous.
// Usage : node docs/build-formation.mjs   (après `npm run build` dans backend/ et web/e2e/captures-formation.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROLES = require(path.join(dir, '..', 'backend', 'dist', 'users', 'standard-roles.js')).STANDARD_ROLES;
const caps = JSON.parse(fs.readFileSync(path.join(dir, 'captures', 'formation', 'index.json'), 'utf8'));
const demo = JSON.parse(fs.readFileSync(process.env.DEMO_JSON ?? '/tmp/demo-accounts.json', 'utf8'));
const emailOf = Object.fromEntries(demo.accounts.map((a) => [a.role, a]));
const PASS = demo.password;
const [CV1, CV2, CV3] = demo.convoys ?? ['SC000000-2026-BRA-1', 'SC000000-2026-BRA-2', 'SC000000-2026-BRA-3'];

const LEGENDE = {
  accueil: 'Tableau de bord : les indicateurs affichés dépendent de vos droits.',
  producteurs: 'Liste des producteurs de la coopérative.',
  parcelles: 'Parcelles, superficies déclarées, état de vérification et versions du tracé.',
  cartographie: 'Carte, anomalies géographiques et couches de référence.',
  convois: 'Convois des collecteurs : en route, reçus au magasin, réglés en caisse.',
  stocks: 'Stocks par magasin et par lot, traçabilité du lot.',
  inventaire: 'Inventaires : comptage physique, écarts, approbation.',
  operations: 'Mes opérations : reçus à imprimer et demandes d\'annulation.',
  compte: 'Mon compte : changer son mot de passe.',
  finances: 'Comptes, caisses et comptabilité (écritures non modifiables, corrigées par écriture inverse).',
  rapprochement: 'Rapprochement bancaire : import du relevé (CSV) et pointage des opérations.',
  rapports: 'Rapports et exports Excel.',
  'envoi-auto': 'Envoi automatique : rapports programmés (quotidien, hebdomadaire, mensuel).',
  equipe: 'Équipe : comptes, rôles, profil de la coopérative et logo.',
  prefinancement: 'Prêts et préfinancements : demande, approbation, décaissement, remboursements.',
  declarations: 'Déclarations d\'achat des collecteurs, à mettre en vérification puis valider.',
  missions: 'Missions (tâches de terrain) : création, suivi, validation.',
  terrain: 'Relevés de terrain : formations, infrastructures sociales, distributions.',
  qualite: 'Qualité : règles, inspections, certificats.',
  commerce: 'Commerce : acheteurs, contrats, commandes.',
  'mes-achats': 'Mes achats : achats déclarés par le collecteur.',
  'mon-stock': 'Mon stock : stock du collecteur et solde de son compte.',
  historique: 'Historique du collecteur.',
  'modules-formation': 'Modules de formation : bibliothèque préchargée (cacao puis café), à conserver, modifier ou supprimer.',
};

// Contenu pédagogique par profil.
const MOD = {
  coop_admin: {
    niveau: 'Niveau 4 — Administration',
    duree: '3 h',
    objectifs: ['Créer les comptes et attribuer les rôles types', 'Renseigner le profil et le logo de la coopérative', 'Traiter les demandes d\'annulation', 'Programmer l\'envoi automatique de rapports', 'Réinitialiser un mot de passe'],
    pas: [
      ['Créer un compte', 'Menu **Équipe** → section des utilisateurs → créer : nom, e-mail, mot de passe provisoire, **rôle**. Les modèles de rôles (magasinier, caissier…) évitent de cocher des droits un par un.'],
      ['Renseigner le profil', 'Menu **Équipe** → *Profil de la coopérative* : nom commercial, adresse, téléphone, e-mail, devise. Ces informations figurent en tête des reçus imprimés. Ajoutez le **logo** (PNG ou JPEG, 1 Mo maximum).'],
      ['Traiter une annulation', 'Menu **Mes opérations** → onglet *Demandes d\'annulation* → **Traiter** : lisez le motif, puis approuvez ou refusez en justifiant. La personne qui a fait la demande ne peut pas l\'approuver elle-même.'],
      ['Réinitialiser un mot de passe', '**Équipe** → utilisateur → *Réinitialiser le mot de passe*. Un mot de passe temporaire s\'affiche **une seule fois** ; l\'utilisateur devra en choisir un nouveau à la connexion.'],
      ['Programmer un rapport', 'Menu **Rapports** → onglet *Envoi automatique* : choisissez le rapport, la fréquence et les destinataires (ils doivent avoir le droit de voir ce rapport).'],
    ],
    exos: [
      ['Créez un compte « Magasinier » pour un collègue fictif, connectez-vous avec, puis vérifiez les menus visibles.', 'Le menu ne contient ni Finances ni Équipe ; la première connexion impose le changement de mot de passe uniquement après une réinitialisation.'],
      ['Approuvez la demande d\'annulation de la réception {{CV2}} (compte direction ou administrateur).', 'La réception passe en « annulée » ; une contre-passation apparaît dans le stock, l\'original reste visible.'],
      ['Programmez le rapport Finances chaque lundi pour le compte Direction.', 'La programmation apparaît dans la liste ; Direction reçoit une notification à chaque exécution.'],
    ],
  },
  magasinier: {
    niveau: 'Niveau 1 — Opérateur', duree: '1 h 30',
    objectifs: ['Réceptionner un convoi et peser', 'Imprimer le reçu', 'Demander l\'annulation d\'une réception faite par erreur', 'Consulter les stocks'],
    pas: [
      ['Voir les convois attendus', 'Menu **Convois** → onglet *Réception au magasin* : les convois « en route » des collecteurs apparaissent.'],
      ['Réceptionner', 'Choisissez le collecteur et le convoi, saisissez le **poids reçu** et le nombre de sacs, indiquez le magasin, puis validez. Le convoi passe à « Reçu — en caisse » et le stock est mis à jour.'],
      ['Imprimer le reçu', 'Menu **Mes opérations** → ligne de l\'opération → **Imprimer le reçu**. Une réimpression porte la mention *duplicata* et est tracée.'],
      ['Demander une annulation', 'Dans **Mes opérations**, sur une opération erronée : demandez l\'annulation en précisant le motif. Un responsable décidera ; vous suivez l\'avancement dans l\'onglet *Mes demandes*.'],
    ],
    exos: [
      ['Réceptionnez le convoi {{CV3}} (poids : 2 080 kg, 32 sacs).', 'Le convoi passe à « Reçu — en caisse » et le stock du lot augmente de 2 080 kg.'],
      ['Imprimez le reçu de cette réception, puis réimprimez-le.', 'La seconde impression porte « duplicata ».'],
      ['Demandez l\'annulation de cette réception (motif : poids saisi par erreur).', 'La demande apparaît « en attente » ; l\'opération reste valable tant qu\'elle n\'est pas approuvée.'],
    ],
  },
  caissier: {
    niveau: 'Niveau 1 — Opérateur', duree: '1 h 30',
    objectifs: ['Traiter un convoi reçu (règlement du collecteur)', 'Tenir la caisse (entrées/sorties) avec justificatif', 'Consulter les comptes collecteurs', 'Imprimer les reçus et demander une annulation'],
    pas: [
      ['Ouvrir la session de caisse', 'Menu **Convois** → onglet *Caisse* : ouvrez la session avec le fonds de caisse initial.'],
      ['Régler un convoi', 'Onglet *Convois* : sur un convoi « Reçu — en caisse », saisissez le **prix unitaire** du jour. Le montant = poids reçu × prix ; l\'écriture de caisse et le compte du collecteur sont créés automatiquement.'],
      ['Saisir une opération de caisse', 'Onglet *Caisse* : sens (entrée/sortie), montant, motif obligatoire. Aucune suppression possible : une erreur se corrige par une écriture inverse.'],
      ['Suivre les comptes collecteurs', 'Onglet *Comptes collecteurs* : soldes, avances et retenues.'],
    ],
    exos: [
      ['Réglez le convoi {{CV3}} (réceptionné par le magasinier à son exercice) au prix de 1 000 F/kg.', 'Montant = poids reçu × 1 000 (ex. 2 080 kg → 2 080 000 F) ; le convoi passe à « Réglé ».'],
      ['Enregistrez une sortie de caisse de 15 000 F « Achat de papier ».', 'Le solde de la caisse diminue de 15 000 F ; l\'opération est datée et attribuée à votre compte.'],
      ['Imprimez le reçu de règlement.', 'Le reçu porte l\'en-tête de la coopérative (nom, logo, adresse).'],
    ],
  },
  comptable: {
    niveau: 'Niveau 2 — Gestion', duree: '2 h',
    objectifs: ['Passer des écritures comptables équilibrées', 'Importer un relevé bancaire et pointer', 'Demander l\'annulation d\'une écriture'],
    pas: [
      ['Passer une écriture', 'Menu **Finances** → onglet *Comptabilité* → nouvelle écriture : journal, date, libellé, lignes (compte, débit ou crédit). Elle doit être **équilibrée**.'],
      ['Importer un relevé bancaire', 'Onglet *Rapprochement bancaire* : choisissez le compte, le fichier CSV et associez les colonnes (date, libellé, débit, crédit). Utilisez d\'abord la **simulation**.'],
      ['Pointer', 'Les lignes évidentes sont pointées automatiquement (même sens, même montant, ±3 jours, un seul candidat). Pointez les autres à la main.'],
    ],
    exos: [
      ['Passez une écriture « Cotisation » : 571 Caisse au débit, 758 Produits divers au crédit, 20 000 F.', 'L\'écriture apparaît au journal ; une écriture déséquilibrée est refusée.'],
      ['Importez le relevé de démonstration en simulation puis pour de bon.', 'Les lignes sont pointées automatiquement ; les écarts restent « non rapprochés ».'],
    ],
  },
  direction: {
    niveau: 'Niveau 3 — Pilotage', duree: '1 h 30',
    objectifs: ['Suivre l\'activité (tableau de bord, rapports)', 'Approuver ou refuser des demandes d\'annulation', 'Approuver un prêt'],
    pas: [
      ['Lire le tableau de bord', 'Page d\'accueil : stocks, finances, alertes selon vos droits.'],
      ['Décider d\'une annulation', 'Menu **Mes opérations** → *Demandes d\'annulation* → **Traiter**. Vous ne pouvez pas décider de vos propres demandes.'],
      ['Approuver un prêt', 'Menu **Préfinancement** (ou Finances) : ouvrez la demande, vérifiez l\'échéancier, approuvez. Le demandeur ne peut pas approuver son propre prêt.'],
    ],
    exos: [
      ['Approuvez la demande d\'annulation en attente de la réception {{CV2}}.', 'Statut « approuvée » ; le demandeur est notifié.'],
      ['Ouvrez le rapport Finances et exportez-le vers Excel.', 'Un fichier .xlsx est téléchargé.'],
    ],
  },
  responsable_tracabilite: {
    niveau: 'Niveau 2 — Gestion', duree: '1 h 30',
    objectifs: ['Contrôler les déclarations d\'achat', 'Remonter la chaîne de traçabilité d\'un lot', 'Suivre les producteurs'],
    pas: [
      ['Vérifier les déclarations', 'Menu **Déclarations d\'achat** : les déclarations « Reçue » attendent une mise en vérification, puis validation.'],
      ['Tracer un lot', 'Menu **Stocks et lots** (si accessible) ou la fiche du lot : bouton *Traçabilité* pour voir producteurs, parcelles, convois et pesées.'],
    ],
    exos: [
      ['Mettez en vérification la déclaration de TAPE Joséphine.', 'Son statut passe à « En vérification ».'],
      ['Recherchez un reçu par numéro et retrouvez le producteur.', 'La fiche du producteur s\'affiche avec ses parcelles.'],
    ],
  },
  responsable_cartographie: {
    niveau: 'Niveau 2 — Gestion', duree: '1 h 30',
    objectifs: ['Vérifier les parcelles et leurs tracés', 'Traiter les anomalies géographiques', 'Importer des couches de référence'],
    pas: [
      ['Contrôler une parcelle', 'Menu **Parcelles** : ouvrez la fiche, comparez la superficie déclarée à celle du tracé puis lancez le contrôle.'],
      ['Traiter les anomalies', 'Menu **Cartographie** → onglet des anomalies : chevauchements, zones protégées, doublons. Décidez (corriger, justifier, rejeter).'],
      ['Consulter l\'historique du tracé', 'Dans la fiche de la parcelle : *Versions du tracé* (auteur, motif, date).'],
    ],
    exos: [
      ['Contrôlez la parcelle de KONE Awa.', 'Le statut de contrôle est mis à jour.'],
      ['Repérez sur la carte une parcelle sans tracé.', 'La parcelle de ADJE Sylvain n\'a pas de tracé : elle est signalée.'],
    ],
  },
  cartographe: {
    niveau: 'Niveau 1 — Opérateur', duree: '1 h',
    objectifs: ['Saisir ou importer le tracé d\'une parcelle', 'Consulter les anomalies'],
    pas: [
      ['Créer une parcelle', 'Menu **Parcelles** → nouvelle parcelle : producteur, filière, superficie déclarée, tracé (ou import de fichier).'],
      ['Corriger un tracé', 'Modifiez le tracé depuis la fiche ; l\'ancienne version est conservée dans *Versions du tracé*.'],
    ],
    exos: [
      ['Ajoutez le tracé de la parcelle de ADJE Sylvain.', 'La parcelle n\'est plus signalée « sans tracé ».'],
    ],
  },
  agent_terrain: {
    niveau: 'Niveau 1 — Opérateur', duree: '1 h 30', mobile: ['coach'],
    objectifs: ['Enregistrer un producteur', 'Exécuter une mission', 'Saisir un relevé de terrain (même hors connexion)'],
    pas: [
      ['Se connecter', '**Application mobile uniquement** : ce compte est refusé sur le portail web (message « Ce compte se connecte uniquement par l\'application mobile »).'],
      ['Enregistrer un producteur', 'Application → **Producteurs** → nouveau : nom, prénoms, village, section, téléphone, filière. Recherche par nom ou code et filtre par section.'],
      ['Exécuter une mission', 'Fiche du producteur → onglet **Tâches** : suivez les instructions, joignez des preuves (photos). Une tâche terminée et validée par l\'ADG est grisée, non cliquable, puis disparaît de la liste après le délai fixé par l\'ADG.'],
      ['Saisir un relevé', 'Formation, infrastructure sociale ou distribution. La saisie fonctionne hors connexion et se synchronise ensuite.'],
    ],
    exos: [
      ['Enregistrez un nouveau producteur fictif dans le village de Hiré.', 'Il apparaît dans la liste, filière Cacao.'],
      ['Exécutez la mission « Visite de la parcelle de Awa KONE ».', 'La mission passe en attente de validation ; une fois validée par l\'ADG, elle est grisée dans la liste.'],
    ],
  },
  responsable_magasin: {
    niveau: 'Niveau 2 — Gestion', duree: '1 h 30',
    objectifs: ['Gérer les magasins', 'Valider les inventaires et les écarts de pesée', 'Ajuster un stock'],
    pas: [
      ['Ouvrir un inventaire', 'Menu **Inventaire** → *Ouvrir un inventaire* : choisissez le magasin, saisissez les quantités comptées.'],
      ['Approuver les écarts', 'Les écarts sont approuvés par vous ; une correction est un mouvement d\'ajustement, jamais une suppression.'],
    ],
    exos: [
      ['Ouvrez un inventaire du Magasin central et comptez 1 940 kg.', 'Un écart de −10 kg apparaît, en attente d\'approbation.'],
    ],
  },
  responsable_financier: {
    niveau: 'Niveau 3 — Pilotage', duree: '2 h',
    objectifs: ['Superviser caisse et comptes', 'Approuver et décaisser des prêts', 'Décider des annulations'],
    pas: [
      ['Superviser la caisse', 'Menu **Finances** : soldes des caisses et comptes, comptabilité, rapprochement.'],
      ['Approuver puis décaisser un prêt', 'Menu **Préfinancement** : approbation avec échéancier, puis décaissement ; enregistrez les remboursements.'],
      ['Décider d\'une annulation', 'Menu **Mes opérations** → *Demandes d\'annulation*.'],
    ],
    exos: [
      ['Approuvez la demande de prêt de KONE Awa (90 000 F) avec deux échéances.', 'Le prêt passe à « approuvé » ; l\'échéancier est créé.'],
    ],
  },
  responsable_qualite: {
    niveau: 'Niveau 2 — Gestion', duree: '1 h 30',
    objectifs: ['Définir des règles de qualité', 'Réaliser une inspection', 'Suivre les certificats'],
    pas: [
      ['Définir une règle', 'Menu **Qualité** → règles : code, libellé, seuil (ex. humidité ≤ 8 %), bloquante ou non.'],
      ['Inspecter un lot', 'Créez une inspection sur le lot, démarrez-la, saisissez les résultats puis terminez avec un résumé.'],
    ],
    exos: [
      ['Inspectez le lot LOT-CACAO-2026-00001 avec une humidité de 9,1 %.', 'Le résultat est non conforme (seuil 8 %) et bloquant.'],
    ],
  },
  responsable_logistique: {
    niveau: 'Niveau 2 — Gestion', duree: '1 h',
    objectifs: ['Suivre les expéditions et commandes', 'Consulter les stocks et documents d\'export'],
    pas: [
      ['Suivre les commandes', 'Commandes et expéditions selon vos droits ; documents joints aux dossiers d\'export.'],
    ],
    exos: [['Repérez la commande de démonstration et son acheteur.', 'Le contrat CT-DEMO-001 et la commande associée sont visibles.']],
  },
  auditeur: {
    niveau: 'Niveau 3 — Contrôle', duree: '1 h',
    objectifs: ['Consulter sans rien modifier', 'Retrouver un fait dans le journal d\'audit'],
    pas: [
      ['Naviguer en lecture seule', 'Tous les écrans sont consultables ; aucun bouton de saisie n\'est proposé.'],
      ['Exporter un rapport', 'Menu **Rapports** : export Excel pour vos propres analyses.'],
    ],
    exos: [['Tentez de modifier une écriture comptable.', 'Impossible : aucun bouton de modification n\'est offert.']],
  },
  acheteur: {
    niveau: 'Niveau 1 — Partenaire externe', duree: '45 min',
    objectifs: ['Consulter ses commandes, expéditions et documents'],
    pas: [['Consulter ses commandes', 'Menu **Commerce** : seules vos commandes et vos documents sont visibles.']],
    exos: [['Ouvrez la commande de démonstration.', 'Vous voyez la ligne « Cacao fèves — 2 000 kg ».']],
  },
  collecteur: {
    niveau: 'Niveau 1 — Opérateur', duree: '2 h', mobile: ['collecteur'],
    objectifs: ['Déclarer un achat chez un producteur', 'Créer un convoi', 'Consulter son stock et sa fiche de compte'],
    pas: [
      ['Se connecter', '**Application mobile uniquement** : ce compte est refusé sur le portail web.'],
      ['Déclarer un achat', 'Sur le téléphone : **Nouvel achat** → choisir le producteur → quantité, unité, sacs. L\'achat se synchronise dès que le réseau est disponible.'],
      ['Créer un convoi', 'Sur le téléphone : **Convoi** → chauffeur, camion, sacs et poids annoncés. Le **numéro de connaissement est attribué par le logiciel** : `code CCC de la coopérative` - `année` - `3 premières lettres du nom du collecteur` - `n° d\'ordre` (ex. `{{CV1}}`). Hors connexion, le numéro définitif est attribué à l\'envoi.'],
      ['Suivre son stock et son compte', 'Sur le téléphone : *Mon stock*, *Historique* et *Fiche de compte*.'],
    ],
    exos: [
      ['Déclarez un achat de 3 sacs chez TRAORE Moussa.', 'L\'achat apparaît « Soumis » dans Mes achats.'],
      ['Créez un convoi (28 sacs, 1 800 kg annoncés) sans saisir de numéro.', 'Le logiciel attribue le numéro : code CCC, année, 3 premières lettres de votre nom, n° d\'ordre (ex. {{CV1}} pour le 1er convoi de Brahima). Le convoi apparaît « En route » côté magasin.'],
    ],
  },
  adg: {
    niveau: 'Niveau 3 — Pilotage', duree: '2 h',
    objectifs: ['Suivre la conformité et les certificats', 'Mettre en place les missions des coachs', 'Décider de leurs demandes'],
    pas: [
      ['Suivre les certificats', 'Rapports et alertes : le certificat de démonstration expire dans moins de 30 jours.'],
      ['Créer et affecter une mission', 'Menu **Missions** : titre, catégorie, priorité, échéance, producteur, coach assigné, critères de validation ; publiez.'],
      ['Valider le résultat', 'Revoyez les preuves transmises par le coach puis validez ou demandez une correction. Une tâche validée est grisée ; elle disparaît de la liste après le nombre de jours réglé en haut de la page *Missions* (« Jours de visibilité des missions validées », 7 par défaut).'],
      ['Gérer les modules de formation', 'Menu **Modules de formation** : une bibliothèque agricole (cacao en priorité, puis café) liée aux certifications est préchargée. Pour chaque module : *Conserver* (validé tel quel), *Modifier* ou *Supprimer*. *Rétablir les modules par défaut* ne rajoute que les modules supprimés. Le contenu fourni est un socle général : adaptez-le à votre cahier des charges de certification.'],
    ],
    exos: [['Créez une mission de formation et assignez-la au coach.', 'Le coach la voit dans ses missions (application mobile).'], ['Dans **Modules de formation**, modifiez un module cacao puis supprimez un module café.', 'Le module modifié est marqué « Modifié » ; le coach ne voit plus le module supprimé après actualisation.']],
  },
  coach: {
    niveau: 'Niveau 1 — Opérateur', duree: '2 h', mobile: ['coach'],
    objectifs: ['Exécuter ses missions', 'Rechercher et filtrer les producteurs par section', 'Consulter les modules de formation', 'Enregistrer producteurs, parcelles et relevés'],
    pas: [
      ['Se connecter', '**Application mobile uniquement** : ce compte est refusé sur le portail web.'],
      ['Trouver un producteur', 'Application → **Producteurs** : tapez un nom, un code ou un village, et touchez une *section* pour ne voir que ses producteurs.'],
      ['Lire un module de formation', 'Application → **Modules de formation** : filtrez par culture (cacao, café) ou par thème, ouvrez un module (objectifs, points à enseigner, erreurs à éviter, questions de vérification). Les modules sont conservés sur le téléphone pour être lus sans réseau.'],
      ['Lire ses missions', 'Fiche du producteur → **Tâches** : instructions, échéance, résultat attendu. Les tâches terminées et validées sont grisées.'],
      ['Saisir un relevé', 'Formations, infrastructures sociales, distributions (liste de bénéficiaires, articles) avec photos.'],
    ],
    exos: [['Saisissez une formation de 12 participants à Hiré.', 'Le relevé apparaît dans **Relevés de terrain** (portail de l\'ADG) après synchronisation.'], ['Filtrez les producteurs sur la section Est, puis ouvrez le module « Fermentation du cacao ».', 'La liste est réduite à la section ; le module s\'ouvre, même sans réseau après une première ouverture.']],
  },
};

const ORDER = ['coop_admin', 'magasinier', 'caissier', 'comptable', 'direction', 'responsable_financier', 'responsable_magasin', 'responsable_tracabilite', 'responsable_cartographie', 'cartographe', 'agent_terrain', 'responsable_qualite', 'responsable_logistique', 'auditeur', 'acheteur', 'collecteur', 'adg', 'coach'];
const rel = (f) => `captures/formation/${f}`;
const mob = (f) => `captures/mobile/${f}`;
const hasMobile = (f) => fs.existsSync(path.join(dir, 'captures', 'mobile', f));

let md = `# AgriTrace — Guide de formation par profil

> Support de formation animé en salle ou en autonomie, avec la **version de démonstration** (données fictives).
> Chaque module correspond à un profil de compte : objectifs, pas à pas, captures d'écran, exercices avec le résultat attendu.

## 1. Comment utiliser ce guide

1. Installez la version de démonstration (voir \`docs/DEMO.md\`) ou connectez-vous à l'instance fournie par le formateur.
2. Chaque stagiaire reçoit **un compte** correspondant à son futur poste (liste en section 3).
3. Suivez le module de votre profil, réalisez les exercices, cochez la liste « Acquis » en fin de module.
4. Les données sont **entièrement fictives** : on peut se tromper, annuler, recommencer. Le formateur peut réinstaller la démonstration à tout moment.

Les captures ont été prises sur la version de démonstration ; les libellés des boutons peuvent différer légèrement selon la version installée.

## 2. Niveaux de compte

| Niveau | Profils | Peut… | Ne peut pas… |
|---|---|---|---|
| **1 — Opérateur** | Magasinier, caissier, agent de terrain, cartographe, collecteur, coach, acheteur (partenaire) | Saisir dans son périmètre, imprimer ses reçus, **demander** une annulation | Approuver une annulation, voir hors de son périmètre |
| **2 — Gestion** | Comptable, responsable magasin, traçabilité, cartographie, qualité, logistique | Valider, ajuster, contrôler dans son domaine | Approuver les prêts et les annulations (sauf droit explicite) |
| **3 — Pilotage / contrôle** | Direction, responsable financier, ADG, auditeur | Approuver (annulations, prêts, écarts), suivre toute l'activité ; l'auditeur lit seulement | Saisir au quotidien (hors responsable financier) |
| **4 — Administration** | Administrateur de la coopérative | Tout dans sa coopérative : comptes, rôles, profil, annulations | Voir les autres coopératives |

Principes communs, à répéter en formation :
- **Rien ne se supprime** : une erreur se corrige par une écriture ou un mouvement inverse, après approbation d'un supérieur.
- **Demandeur ≠ approbateur** : on ne valide jamais sa propre demande.
- **Tout est tracé** : chaque reçu imprimé, chaque décision et chaque réimpression (« duplicata »).
- **Hors connexion** : le téléphone enregistre localement et synchronise ensuite.

## 3. Comptes de la démonstration

Mot de passe commun : \`${PASS}\` (à changer pour toute utilisation réelle).

| Profil | Utilisateur fictif | Identifiant |
|---|---|---|
${demo.accounts.map((a) => `| ${a.label} | ${a.name} | \`${a.email}\` |`).join('\n')}

## 4. Parcours conseillés

- **Chaîne d'achat** (demi-journée) : collecteur → magasinier → caissier → comptable → direction.
- **Contrôle et conformité** (demi-journée) : agent de terrain / cartographe → responsable cartographie → responsable traçabilité → qualité → ADG.
- **Pilotage** (2 h) : direction, responsable financier, auditeur, administrateur.

`;

let n = 5;
for (const role of ORDER) {
  const m = MOD[role];
  if (!m) continue;
  const tpl = ROLES[role];
  const acc = emailOf[role];
  const name = role === 'coop_admin' ? 'Administrateur de la coopérative' : tpl.name;
  md += `\n---\n\n## ${n++}. ${name}\n\n`;
  md += `**${m.niveau}** · durée indicative : ${m.duree} · compte de démonstration : \`${acc.email}\`\n\n`;
  md += `${role === 'coop_admin' ? 'Responsable de la coopérative : crée les comptes, attribue les rôles, décide des annulations et programme les rapports.' : tpl.description}\n\n`;
  md += `### Objectifs\n\n${m.objectifs.map((o) => `- ${o}`).join('\n')}\n\n`;
  const shots = (caps[role] ?? []).filter((c) => c.visible);
  if (shots.length) {
    md += `### Ce que vous voyez\n\n`;
    for (const s of shots.slice(0, 4)) md += `![${LEGENDE[s.name] ?? s.name}](${rel(s.file)})\n\n*${LEGENDE[s.name] ?? s.name}*\n\n`;
  }
  const mobs = (m.mobile ?? []).flatMap((p) => ['accueil', ...(p === 'collecteur' ? ['nouvel-achat', 'convoi', 'fiche'] : ['formations', 'infrastructure', 'producteurs'])].map((x) => `${p}-${x}.png`)).filter(hasMobile);
  if (mobs.length) {
    md += `### Sur le téléphone\n\n<table class="phones"><tr>${mobs.slice(0, 4).map((f) => `<td><img src="${mob(f)}" alt="${f.replace('.png', '')}"></td>`).join('')}</tr></table>\n\n`;
  }
  md += `### Pas à pas\n\n${m.pas.map(([t, d], i) => `${i + 1}. **${t}.** ${d}`).join('\n')}\n\n`;
  if (role !== 'coop_admin') md += `### Ce que ce profil ne voit pas\n\n${tpl.hidden.map((h) => `- ${h}`).join('\n')}\n\n`;
  md += `### Exercices\n\n| # | À faire | Résultat attendu |\n|---|---|---|\n${m.exos.map(([q, r], i) => `| ${i + 1} | ${q} | ${r} |`).join('\n')}\n\n`;
  md += `### Acquis (à cocher)\n\n${m.objectifs.map((o) => `- [ ] ${o}`).join('\n')}\n`;
}

md += `\n---\n\n## ${n}. Évaluation finale (30 min)\n\nScénario commun, à dérouler à plusieurs comptes :\n\n1. **Collecteur** : déclare un achat et crée un convoi (numéro attribué automatiquement).\n2. **Magasinier** : réceptionne le convoi (poids différent du déclaré) et imprime le reçu.\n3. **Caissier** : règle le convoi au prix du jour.\n4. **Comptable** : passe l'écriture correspondante et pointe le relevé.\n5. **Magasinier** : constate une erreur de poids et demande l'annulation.\n6. **Direction ou administrateur** : décide de la demande.\n7. **Auditeur** : retrouve l'ensemble des traces (reçus, demande, décision).\n\nCritères : respect du circuit, aucune suppression, motifs renseignés, reçus imprimés, demandeur ≠ approbateur.\n`;
md = md.replaceAll('{{CV1}}', CV1).replaceAll('{{CV2}}', CV2).replaceAll('{{CV3}}', CV3);
fs.writeFileSync(path.join(dir, 'GUIDE_FORMATION.md'), md);
console.log('GUIDE_FORMATION.md :', md.length, 'caractères');
