# AgriTrace — Guide de formation par profil

> Support de formation animé en salle ou en autonomie, avec la **version de démonstration** (données fictives).
> Chaque module correspond à un profil de compte : objectifs, pas à pas, captures d'écran, exercices avec le résultat attendu.

## 1. Comment utiliser ce guide

1. Installez la version de démonstration (voir `docs/DEMO.md`) ou connectez-vous à l'instance fournie par le formateur.
2. Chaque stagiaire reçoit **un compte** correspondant à son futur poste (liste en section 3).
3. Suivez le module de votre profil, réalisez les exercices, cochez la liste « Acquis » en fin de module.
4. Les données sont **entièrement fictives** : on peut se tromper, annuler, recommencer. Le formateur peut réinstaller la démonstration à tout moment.

**Ouvrir un écran sur un autre.** Dans les listes, les noms soulignés en pointillés (producteur dans les déclarations d'achat, délégué dans la file de la caisse, les convois et l'état des délégués, compte bancaire dans le bandeau « Fonds disponible ») ouvrent l'écran lié **par-dessus** l'écran courant. Le fil d'Ariane en haut de la fenêtre rappelle d'où l'on vient ; **← Retour** revient à la fenêtre précédente, **✕ Fermer** ou la touche **Échap** ramène à l'écran d'origine, resté exactement comme on l'a laissé.

**Saisies courtes en fenêtre.** Dans la Caisse, « Enregistrer une entrée / sortie » et « Créer une caisse » s'ouvrent dans une fenêtre centrée par-dessus l'écran ; fermez-la (✕ Fermer ou Échap) pour retrouver votre travail. Les états larges (journaux, soldes des délégués) restent dans l'écran.

![Fiche du producteur ouverte par-dessus la liste des déclarations d'achat](captures/fenetre-liee-producteur.png)

Les captures ont été prises sur la version de démonstration ; les libellés des boutons peuvent différer légèrement selon la version installée.

## 2. Niveaux de compte

| Niveau | Profils | Peut… | Ne peut pas… |
|---|---|---|---|
| **1 — Opérateur** | Magasinier, caissier, agent de terrain, cartographe, délégué, coach, acheteur et exportateur (partenaires) | Saisir dans son périmètre, imprimer ses reçus, **demander** une annulation | Approuver une annulation, voir hors de son périmètre |
| **2 — Gestion** | Comptable, responsable magasin, traçabilité, cartographie, qualité, logistique | Valider, ajuster, contrôler dans son domaine | Approuver les prêts et les annulations (sauf droit explicite) |
| **3 — Pilotage / contrôle** | Direction, responsable financier, ADG, auditeur | Approuver (annulations, prêts, écarts), suivre toute l'activité ; l'auditeur lit seulement | Saisir au quotidien (hors responsable financier) |
| **4 — Administration** | Administrateur de la coopérative | Tout dans sa coopérative : comptes, rôles, profil, annulations | Voir les autres coopératives |

Principes communs, à répéter en formation :
- **Rien ne se supprime** : une erreur se corrige par une écriture ou un mouvement inverse, après approbation d'un supérieur.
- **Demandeur ≠ approbateur** : on ne valide jamais sa propre demande.
- **Tout est tracé** : chaque reçu imprimé, chaque décision et chaque réimpression (« duplicata »).
- **Hors connexion** : le téléphone enregistre localement et synchronise ensuite.

## 3. Comptes de la démonstration

Mot de passe commun : `Demo-AgriTrace-2026!` (à changer pour toute utilisation réelle).

| Profil | Utilisateur fictif | Identifiant |
|---|---|---|
| Administrateur de la coopérative | Adjoua Konan | `admin@demo.agritrace.test` |
| Magasinier | Mamadou Coulibaly | `magasinier@demo.agritrace.test` |
| Caissier / caissière | Aya Kouamé | `caissier@demo.agritrace.test` |
| Comptable | Salif Ouédraogo | `comptable@demo.agritrace.test` |
| Direction | Nathalie Boni | `direction@demo.agritrace.test` |
| Responsable traçabilité | Éric Tano | `responsable.tracabilite@demo.agritrace.test` |
| Responsable cartographie | Clarisse Ahoua | `responsable.cartographie@demo.agritrace.test` |
| Cartographe | Jean-Marc Gnahoré | `cartographe@demo.agritrace.test` |
| Agent de terrain | Rosine Yapi | `agent.terrain@demo.agritrace.test` |
| Responsable de magasin | Daouda Fofana | `responsable.magasin@demo.agritrace.test` |
| Responsable financier | Estelle Aké | `responsable.financier@demo.agritrace.test` |
| Responsable qualité | Hortense Zadi | `responsable.qualite@demo.agritrace.test` |
| Responsable logistique | Lassina Cissé | `responsable.logistique@demo.agritrace.test` |
| Auditeur (lecture seule) | Patrick Dago | `auditeur@demo.agritrace.test` |
| Acheteur / commercial | Fanta Kamara | `acheteur@demo.agritrace.test` |
| Collecteur (application téléphone) | Brahima Sylla | `collecteur@demo.agritrace.test` |
| Assistant de direction générale | Mireille Ouattara | `adg@demo.agritrace.test` |
| Coach / conseiller agricole | Gilbert Koffi | `coach@demo.agritrace.test` |
| Exportateur (partenaire) | Karim Diallo | `exportateur@demo.agritrace.test` |

## 4. Parcours conseillés

- **Chaîne d'achat** (demi-journée) : délégué → magasinier → caissier → comptable → direction.
- **Contrôle et conformité** (demi-journée) : agent de terrain / cartographe → responsable cartographie → responsable traçabilité → qualité → ADG.
- **Pilotage** (2 h) : direction, responsable financier, auditeur, administrateur.


## 5. Parcours complet simulé : du terrain à l'exportateur

Ce chapitre déroule **une même chaîne, de bout en bout**, avec les comptes de la démonstration (données fictives). Chaque étape est jouée par le profil concerné ; les formulaires sont remplis. Le téléphone du délégué est simulé par les écrans de l'application.

**Fil conducteur.** Le délégué achète du cacao à deux producteurs et déclare un connaissement qui les transporte (n° SC000000-2026-BRA-4). Le responsable traçabilité valide les achats ; le magasinier pèse ce connaissement, puis pèse aussi un connaissement **non déclaré** d'un autre délégué (CV-NC-001). La caisse règle les deux pesées au **prix de la traite fixé par l'administrateur** et retient une somme au kilo (la *mise en compte*). En fin de campagne le compte du délégué est clôturé ; son reversement (sur son compte, par chèque, en espèces ou vers un autre compte) est **approuvé par l'administrateur**. Le comptable retrouve les écritures. Le responsable traçabilité prépare la **fiche d'accompagnement** du chargement (producteurs, poids, sacs, reçus), l'exporte sur le modèle Excel de la coopérative et la **transmet à l'exportateur**. Le stock alimente les ventes, et les modules de l'exportateur redescendent jusqu'aux coachs avant de remonter à l'exportateur.

### Étape 1 — Brahima Sylla : Choisir le producteur

Dans **Acheter**, le délégué cherche le producteur par code ou nom : l'application affiche son code, sa filière et sa campagne.

<p class="phone-one"><img src="captures/mobile/collecteur-choix-producteur.png" alt="Choisir le producteur" width="260"></p>

### Étape 2 — Brahima Sylla : Saisir l'achat

Poids, nombre de sacs et **n° du reçu** remis au producteur. L'achat est enregistré sur le téléphone, même sans réseau.

<p class="phone-one"><img src="captures/mobile/collecteur-achat-saisi.png" alt="Saisir l'achat" width="260"></p>

### Étape 3 — Brahima Sylla : Historique des achats

Après la synchronisation, les achats apparaissent dans l'historique du délégué avec leur état (reçus, en vérification, acceptés).

<p class="phone-one"><img src="captures/mobile/collecteur-historique.png" alt="Historique des achats" width="260"></p>

### Étape 4 — Brahima Sylla : Déclarer le convoi

Le délégué annonce le convoi : n° de connaissement (ou numéro automatique), chauffeur, camion, sacs et poids annoncés.

<p class="phone-one"><img src="captures/mobile/collecteur-convoi-saisi.png" alt="Déclarer le convoi" width="260"></p>

### Étape 5 — Éric Tano : Achats reçus du téléphone

Les achats déclarés par le délégué arrivent dans **Déclarations d'achat** avec le statut « Reçue ».

![Achats reçus du téléphone](captures/parcours/05-responsable_tracabilite-declarations.png)

### Étape 6 — Éric Tano : Mise en vérification

On met l'achat en vérification (confirmation demandée), puis on l'accepte ou on demande une correction.

![Mise en vérification](captures/parcours/06-responsable_tracabilite-verification.png)

### Étape 7 — Éric Tano : Achats acceptés

Les achats acceptés sont désormais reconnus : ils peuvent être pesés au magasin.

![Achats acceptés](captures/parcours/07-responsable_tracabilite-acceptes.png)

### Étape 8 — Mamadou Coulibaly : Pesées du magasin

La liste des pesées (traitées ou non par la caisse). Le bouton **Enregistrer une pesée** ouvre la saisie.

![Pesées du magasin](captures/parcours/08-magasinier-liste.png)

### Étape 9 — Mamadou Coulibaly : Pesée d'un convoi déclaré

On choisit le délégué (ou on saisit son code), le n° de connaissement : chauffeur, camion, sacs et poids déclarés sont repris, avec le **contenu déclaré** (achats chargés). On saisit le poids pesé et les sacs déchargés ; le poids net est calculé (poids − sacs déchargés).

![Pesée d'un convoi déclaré](captures/parcours/09-magasinier-pesee-declaree.png)

### Étape 10 — Mamadou Coulibaly : Pesée enregistrée

La réception est transmise à la caisse. Elle apparaît dans la liste avec son bulletin de pesée.

![Pesée enregistrée](captures/parcours/10-magasinier-pesee-enregistree.png)

### Étape 11 — Mamadou Coulibaly : Pesée d'un convoi non déclaré

Le délégué existe mais n'a pas déclaré ce convoi : le magasinier le choisit dans la liste, saisit le n° de connaissement et les informations du bordereau (chauffeur, camion, sacs et poids déclarés). Le convoi est créé à la réception.

![Pesée d'un convoi non déclaré](captures/parcours/11-magasinier-pesee-non-declaree.png)

### Étape 12 — Mamadou Coulibaly : Les deux pesées

Le convoi déclaré et le convoi non déclaré figurent dans la liste, en attente de traitement par la caisse.

![Les deux pesées](captures/parcours/12-magasinier-pesees-liste.png)

### Étape 13 — Adjoua Konan : Délégué : onglet Transport

Le **coût de transport au kilo** du délégué est préenregistré dans son profil, onglet **Transport**. Seul l'administrateur le saisit ; la caisse le reprend à chaque règlement sans pouvoir le modifier.

![Délégué : onglet Transport](captures/parcours/13-coop_admin-tarif-transport.png)

### Étape 14 — Adjoua Konan : Délégué : onglet Retenues

La **retenue au kilo** (mise en compte) est préenregistrée dans l'onglet **Retenues**, également par l'administrateur seul.

![Délégué : onglet Retenues](captures/parcours/14-coop_admin-tarif-retenue.png)

### Étape 15 — Aya Kouamé : Caisse : fonds disponible

La caissière se connecte par l'écran de connexion du logiciel, comme tout utilisateur : la caisse n'a ni ouverture, ni clôture. Le bandeau du haut affiche en permanence le **fonds disponible** : espèces + comptes bancaires.

![Caisse : fonds disponible](captures/parcours/15-caissier-session.png)

### Étape 16 — Aya Kouamé : Pesées à traiter

La file des réceptions pesées et non encore réglées.

![Pesées à traiter](captures/parcours/16-caissier-a-traiter.png)

### Étape 17 — Aya Kouamé : Règlement d'une pesée

Le P.U. (prix d'achat au kg) est celui **fixé par l'administrateur** pour la traite : il s'affiche mais le caissier ne peut pas le modifier. Le **coût de transport** et la **retenue au kg** viennent eux aussi du profil du délégué (préenregistrés par l'administrateur) et sont affichés sans pouvoir être saisis ; avec le P.U., ils donnent le net à payer, porté au compte du délégué.

![Règlement d'une pesée](captures/parcours/17-caissier-traiter.png)

### Étape 18 — Aya Kouamé : Solde des délégués

Après règlement, le compte de chaque délégué est crédité du net à payer ; la fiche détaille livraisons, avances et soldes.

![Solde des délégués](captures/parcours/18-caissier-soldes.png)

### Étape 19 — Aya Kouamé : Mise en compte des délégués

Pour chaque délégué : somme retenue, reversée, en attente et disponible. Une fois la campagne terminée, le compte du délégué est **clôturé**.

![Mise en compte des délégués](captures/parcours/19-caissier-mise-en-compte.png)

### Étape 20 — Aya Kouamé : Clôturer le compte du délégué

La clôture du compte du délégué (fin de campagne) ouvre la possibilité de reverser sa mise en compte ; une nouvelle livraison rouvre le compte.

![Clôturer le compte du délégué](captures/parcours/20-caissier-cloture.png)

### Étape 21 — Aya Kouamé : Reverser la mise en compte

Le montant disponible peut être reversé **sur le compte du délégué, par chèque, en espèces ou vers un autre compte**. La demande est soumise à l'administrateur de la coopérative.

![Reverser la mise en compte](captures/parcours/21-caissier-reverser.png)

### Étape 22 — Adjoua Konan : Demande à approuver

L'administrateur voit la demande (délégué, montant, destination, demandeur) et l'**approuve ou la refuse** avec un motif. Le demandeur ne peut pas approuver sa propre demande.

![Demande à approuver](captures/parcours/22-coop_admin-demande.png)

### Étape 23 — Adjoua Konan : Reversement approuvé

À l'approbation, le mouvement financier et l'écriture comptable (débit 4781 « Retenues sur règlements des délégués ») sont passés.

![Reversement approuvé](captures/parcours/23-coop_admin-approuvee.png)

### Étape 24 — Salif Ouédraogo : Journal des achats

Chaque pesée réglée a passé son écriture d'achat : produit acheté, transport, compte du délégué et retenue.

![Journal des achats](captures/parcours/24-comptable-journal-achats.png)

### Étape 25 — Salif Ouédraogo : Journal de caisse

Les mouvements de caisse, y compris les reversements en espèces approuvés.

![Journal de caisse](captures/parcours/25-comptable-journal-caisse.png)

### Étape 26 — Éric Tano : Convois pesés : choisir les convois du chargement

Le menu **Fiches d'accompagnement** liste les convois pesés au magasin avec leur nombre de producteurs. **Consulter** affiche les producteurs d'un convoi ; **Exporter (Excel)** produit la fiche sur le modèle de la coopérative.

![Convois pesés : choisir les convois du chargement](captures/parcours/26-responsable_tracabilite-fiches-convois.png)

### Étape 27 — Éric Tano : Producteurs d'un convoi

Nom et prénoms, genre, section, code planteur, date de livraison au magasin, poids net livré, sacs et n° de reçu : les colonnes de la fiche d'accompagnement. Le poids net pesé est réparti entre les producteurs au prorata de leurs achats.

![Producteurs d'un convoi](captures/parcours/27-responsable_tracabilite-fiches-producteurs.png)

### Étape 28 — Éric Tano : Créer la fiche du chargement

Cochez les convois du chargement puis **Créer la fiche** : les producteurs sont repris automatiquement. Renseignez le chauffeur, le camion, la remorque, le LOT ID DSE, le n° de connaissement, la date de départ, le type de cacao et les certifications.

![Créer la fiche du chargement](captures/parcours/28-responsable_tracabilite-fiche-nouvelle.png)

### Étape 29 — Éric Tano : Transmettre la fiche à l'exportateur

Une fiche peut aussi être **importée** (bouton *Importer une fiche (Excel)*) si elle a été remplie ailleurs sur le même modèle. Choisissez l'exportateur : la fiche lui est transmise, il est notifié, et elle ne peut plus être modifiée.

![Transmettre la fiche à l'exportateur](captures/parcours/29-responsable_tracabilite-fiche-transmission.png)

### Étape 30 — Karim Diallo : Fiche d'accompagnement reçue

L'exportateur ne voit que les fiches qui lui sont transmises : il les consulte (producteurs du chargement) et les **télécharge au format Excel**.

![Fiche d'accompagnement reçue](captures/parcours/30-exportateur-fiche-recue.png)

### Étape 31 — Daouda Fofana : Stock mis à jour

Les pesées réglées alimentent le stock du magasin ; chaque lot garde sa traçabilité jusqu'au producteur.

![Stock mis à jour](captures/parcours/31-responsable_magasin-stock.png)

### Étape 32 — Fanta Kamara : Vente aux acheteurs

L'acheteur suit contrats et commandes ; les quantités vendues sortent du stock.

![Vente aux acheteurs](captures/parcours/32-acheteur-commerce.png)

### Étape 33 — Mireille Ouattara : Modules proposés par l'exportateur

L'exportateur propose ses modules ; l'ADG les transmet aux coachs.

![Modules proposés par l'exportateur](captures/parcours/33-adg-modules.png)

### Étape 34 — Mireille Ouattara : Résultats des coachs

Les résultats saisis par les coachs sur le terrain sont transmis à l'exportateur.

![Résultats des coachs](captures/parcours/34-adg-resultats.png)

### Étape 35 — Karim Diallo : Suivi par l'exportateur

L'exportateur suit ses propositions et reçoit les résultats transmis : la boucle du terrain à l'exportateur est bouclée.

![Suivi par l'exportateur](captures/parcours/35-exportateur-suivi.png)

### Étape 36 — Gilbert Koffi : Résultats saisis sur le terrain

Le coach saisit le résultat de la séance (village, participants, note moyenne) sur son téléphone ; il remonte à l'ADG puis à l'exportateur.

<p class="phone-one"><img src="captures/mobile/coach-module-resultats.png" alt="Résultats saisis sur le terrain" width="260"></p>


---

## 6. Administrateur de la coopérative

**Niveau 4 — Administration** · durée indicative : 3 h · compte de démonstration : `admin@demo.agritrace.test`

Responsable de la coopérative : crée les comptes, attribue les rôles, décide des annulations et programme les rapports.

### Objectifs

- Créer les comptes et attribuer les rôles types
- Renseigner le profil et le logo de la coopérative
- Traiter les demandes d'annulation
- Programmer l'envoi automatique de rapports
- Réinitialiser un mot de passe

### Ce que vous voyez

![Tableau de bord : les indicateurs affichés dépendent de vos droits.](captures/formation/coop_admin-accueil.png)

*Tableau de bord : les indicateurs affichés dépendent de vos droits.*

![Pesées : liste, saisie d'une pesée (délégué, campagne, produit, poids net automatique), analyses et bulletin.](captures/formation/coop_admin-pesees.png)

*Pesées : liste, saisie d'une pesée (délégué, campagne, produit, poids net automatique), analyses et bulletin.*

![Produits (prix d'achat et de vente au kilo) et campagnes.](captures/formation/coop_admin-parametres.png)

*Produits (prix d'achat et de vente au kilo) et campagnes.*

![Liste des producteurs de la coopérative.](captures/formation/coop_admin-producteurs.png)

*Liste des producteurs de la coopérative.*

### Pas à pas

1. **Créer un compte.** Menu **Équipe** → section des utilisateurs → créer : nom, e-mail, mot de passe provisoire, **un ou plusieurs rôles** (cases à cocher : les droits s'additionnent, le menu n'affiche que ce qu'ils permettent ; *Rôles* en ajoute ou en retire ensuite). Les modèles de rôles (magasinier, caissier…) évitent de cocher des droits un par un.
2. **Fixer les prix de la traite.** Menu **Paramètres** → *Produits et campagnes* → **Nouvelle campagne** : à l'ouverture de la traite, vous indiquez le prix d'achat et de vente au kilo de chaque produit. Vous seul pouvez les saisir et les actualiser (*Modifier*, *Historique des prix*) ; la caisse, les pesées et les ventes les reprennent tels quels.
3. **Approuver un reversement de mise en compte.** Menu **Comptabilité** → *Mise en compte des délégués* → onglet *Demandes de reversement* : une fois le compte du délégué clôturé, la caisse demande de reverser sa mise en compte (sur son compte, par chèque, en espèces ou vers un autre compte). Vous **approuvez** (le mouvement et l'écriture sont passés) ou **refusez** avec un motif.
4. **Renseigner le profil.** Menu **Équipe** → *Profil de la coopérative* : nom commercial, adresse, téléphone, e-mail, devise. Ces informations figurent en tête des reçus imprimés. Ajoutez le **logo** (PNG ou JPEG, 1 Mo maximum).
5. **Traiter une annulation.** Menu **Mes opérations** → onglet *Demandes d'annulation* → **Traiter** : lisez le motif, puis approuvez ou refusez en justifiant. La personne qui a fait la demande ne peut pas l'approuver elle-même.
6. **Réinitialiser un mot de passe.** **Équipe** → utilisateur → *Réinitialiser le mot de passe*. Un mot de passe temporaire s'affiche **une seule fois** ; l'utilisateur devra en choisir un nouveau à la connexion.
7. **Programmer un rapport.** Menu **Rapports** → onglet *Envoi automatique* : choisissez le rapport, la fréquence et les destinataires (ils doivent avoir le droit de voir ce rapport).

### Exercices

| # | À faire | Résultat attendu |
|---|---|---|
| 1 | Créez un compte « Magasinier » pour un collègue fictif, connectez-vous avec, puis vérifiez les menus visibles. | Le menu ne contient ni Finances ni Équipe ; la première connexion impose le changement de mot de passe uniquement après une réinitialisation. |
| 2 | Approuvez la demande d'annulation de la réception SC000000-2026-BRA-2 (compte direction ou administrateur). | La réception passe en « annulée » ; une contre-passation apparaît dans le stock, l'original reste visible. |
| 3 | Programmez le rapport Finances chaque lundi pour le compte Direction. | La programmation apparaît dans la liste ; Direction reçoit une notification à chaque exécution. |

### Acquis (à cocher)

- [ ] Créer les comptes et attribuer les rôles types
- [ ] Renseigner le profil et le logo de la coopérative
- [ ] Traiter les demandes d'annulation
- [ ] Programmer l'envoi automatique de rapports
- [ ] Réinitialiser un mot de passe

---

## 7. Magasinier

**Niveau 1 — Opérateur** · durée indicative : 1 h 30 · compte de démonstration : `magasinier@demo.agritrace.test`

Réceptionne et pèse les convois au magasin central, tient les stocks et l'inventaire.

### Objectifs

- Réceptionner un connaissement et peser
- Imprimer le reçu
- Demander l'annulation d'une réception faite par erreur
- Consulter les stocks

### Ce que vous voyez

![Tableau de bord : les indicateurs affichés dépendent de vos droits.](captures/formation/magasinier-accueil.png)

*Tableau de bord : les indicateurs affichés dépendent de vos droits.*

![Pesées : liste, saisie d'une pesée (délégué, campagne, produit, poids net automatique), analyses et bulletin.](captures/formation/magasinier-pesees.png)

*Pesées : liste, saisie d'une pesée (délégué, campagne, produit, poids net automatique), analyses et bulletin.*

![convois](captures/formation/magasinier-convois.png)

*convois*

![Stocks par magasin et par lot, traçabilité du lot.](captures/formation/magasinier-stocks.png)

*Stocks par magasin et par lot, traçabilité du lot.*

### Pas à pas

1. **Ouvrir la saisie de pesée.** Menu **Pesées** → *Enregistrer une pesée*. Saisissez le code du délégué (ou choisissez-le par son nom) : ses connaissements « en route » et la localité de provenance apparaissent.
2. **Peser.** Choisissez la **campagne** et le **produit** (le produit annoncé par le délégué est proposé, vous pouvez toujours le changer). Les informations d'arrivée (déclaré) sont reprises ; saisissez le **poids**, les sacs reçus et les **sacs déchargés** : le **poids net se calcule seul** (poids − sacs déchargés). L'analyse est facultative. Le connaissement passe à « Reçu — en caisse » et le stock est mis à jour.
3. **Imprimer le reçu.** Menu **Mes opérations** → ligne de l'opération → **Imprimer le reçu**. Une réimpression porte la mention *duplicata* et est tracée.
4. **Demander une annulation.** Dans **Mes opérations**, sur une opération erronée : demandez l'annulation en précisant le motif. Un responsable décidera ; vous suivez l'avancement dans l'onglet *Mes demandes*.

### Ce que ce profil ne voit pas

- Conformité / qualité
- Cartographie
- Caisse et comptabilité
- Finances
- Équipe
- Missions
- Préfinancement

### Exercices

| # | À faire | Résultat attendu |
|---|---|---|
| 1 | Pesez le connaissement SC000000-2026-BRA-3 (poids : 2 112 kg, 32 sacs reçus, 32 sacs déchargés). | Le poids net affiché est 2 080 kg (2 112 − 32) ; le connaissement passe à « Reçu — en caisse » et le stock du lot augmente de 2 080 kg. |
| 2 | Imprimez le reçu de cette réception, puis réimprimez-le. | La seconde impression porte « duplicata ». |
| 3 | Demandez l'annulation de cette réception (motif : poids saisi par erreur). | La demande apparaît « en attente » ; l'opération reste valable tant qu'elle n'est pas approuvée. |

### Acquis (à cocher)

- [ ] Réceptionner un connaissement et peser
- [ ] Imprimer le reçu
- [ ] Demander l'annulation d'une réception faite par erreur
- [ ] Consulter les stocks

---

## 8. Caissier

**Niveau 1 — Opérateur** · durée indicative : 1 h 30 · compte de démonstration : `caissier@demo.agritrace.test`

Traite les convois reçus, règle les délégués, tient la caisse et les comptes des délégués.

### Objectifs

- Traiter un connaissement reçu (règlement du délégué)
- Tenir la caisse (entrées/sorties) avec justificatif
- Consulter les comptes délégués
- Imprimer les reçus et demander une annulation

### Ce que vous voyez

![Tableau de bord : les indicateurs affichés dépendent de vos droits.](captures/formation/caissier-accueil.png)

*Tableau de bord : les indicateurs affichés dépendent de vos droits.*

![Caisse : menu à rubriques dépliantes, pesées à traiter, opérations et journal de caisse.](captures/formation/caissier-caisse.png)

*Caisse : menu à rubriques dépliantes, pesées à traiter, opérations et journal de caisse.*

![convois](captures/formation/caissier-convois.png)

*convois*

![Comptes, caisses et comptabilité (écritures non modifiables, corrigées par écriture inverse).](captures/formation/caissier-finances.png)

*Comptes, caisses et comptabilité (écritures non modifiables, corrigées par écriture inverse).*

### Pas à pas

1. **Connaître le fonds disponible.** La caissière se connecte comme tout utilisateur, par l'écran de connexion du logiciel : il n'y a ni ouverture, ni clôture de caisse, ni fonds à compter. Le bandeau en haut du menu **Caisse** affiche en permanence le **fonds disponible** : les espèces et chaque compte bancaire, et leur total. Dans *Enregistrer une entrée / sortie*, le **Mode** (Espèces ou Compte bancaire + banque) précise où va le montant.
2. **Régler un connaissement.** Rubrique *Opérations* → *Traiter une pesée / régler un achat* : sur une pesée « Reçu — en caisse », cliquez **Traiter**. Le **prix unitaire** est celui de la traite, **fixé par l'administrateur** : il s'affiche mais le caissier ne peut pas le modifier. La **retenue au kilo** s'ajoute à la mise en compte du délégué. Le montant = poids net × prix ; l'écriture de caisse et le compte du délégué sont créés automatiquement.
3. **Saisir une opération de caisse.** Rubrique *Mouvements de caisse* → *Enregistrer une entrée / sortie* : **mode** (*Espèces* ou *Compte bancaire* avec la banque choisie : le compte bancaire est une forme de fonds de la caisse), sens, montant, motif obligatoire. Aucune suppression possible : une erreur se corrige par une écriture inverse. Le résultat apparaît dans *Les entrées* ou *Les sorties de caisse*.
4. **Suivre les comptes bancaires.** Rubrique *Mouvements de caisse* → *Évolution des comptes bancaires* : choisissez le compte et la période ; vous voyez le solde d'ouverture, ce qui est **ajouté (+)** et **soustrait (−)**, le solde cumulé et la courbe du solde. Le journal de caisse a un sélecteur *Fonds* (espèces ou compte bancaire).
5. **Suivre les comptes délégués.** Rubrique *Solde délégué* : **couleurs : rouge = ce que fournit la coopérative (financements), noir = ce qu'apporte le délégué ; solde total rouge si le délégué doit à la coopérative, bleu si la coopérative lui doit.** soldes, avances et retenues. Le transport et la retenue au kilo sont fixés par l'administrateur dans la fiche du délégué (onglets *Transport* et *Retenues*) : la caisse ne les saisit pas.

### Ce que ce profil ne voit pas

- Cartographie
- Conformité / qualité
- Équipe
- Missions
- Stocks

### Exercices

| # | À faire | Résultat attendu |
|---|---|---|
| 1 | Réglez le connaissement SC000000-2026-BRA-3 (réceptionné par le magasinier à son exercice) au prix de la traite (fixé par l'administrateur, ex. 1 000 F/kg). | Montant = poids reçu × prix (ex. 2 080 kg × 1 000 → 2 080 000 F) ; le connaissement passe à « Réglé ». |
| 2 | Enregistrez une sortie de caisse de 15 000 F « Achat de papier ». | Le solde de la caisse diminue de 15 000 F ; l'opération est datée et attribuée à votre compte. |
| 3 | Imprimez le reçu de règlement. | Le reçu porte l'en-tête de la coopérative (nom, logo, adresse). |

### Acquis (à cocher)

- [ ] Traiter un connaissement reçu (règlement du délégué)
- [ ] Tenir la caisse (entrées/sorties) avec justificatif
- [ ] Consulter les comptes délégués
- [ ] Imprimer les reçus et demander une annulation

---

## 9. Comptable

**Niveau 2 — Gestion** · durée indicative : 2 h · compte de démonstration : `comptable@demo.agritrace.test`

Passe et consulte les écritures comptables, suit les comptes financiers ; peut demander l'annulation de ses écritures.

### Objectifs

- Passer des écritures comptables équilibrées
- Consulter les comptes et les états
- Demander l'annulation d'une écriture

### Ce que vous voyez

![Tableau de bord : les indicateurs affichés dépendent de vos droits.](captures/formation/comptable-accueil.png)

*Tableau de bord : les indicateurs affichés dépendent de vos droits.*

![Comptabilité : états et journaux, fournisseurs, emprunts, prestations, ventes, impôts.](captures/formation/comptable-comptabilite.png)

*Comptabilité : états et journaux, fournisseurs, emprunts, prestations, ventes, impôts.*

![Partenaires, fournisseurs, clients et prêteurs.](captures/formation/comptable-partenaires.png)

*Partenaires, fournisseurs, clients et prêteurs.*

![Comptes, caisses et comptabilité (écritures non modifiables, corrigées par écriture inverse).](captures/formation/comptable-finances.png)

*Comptes, caisses et comptabilité (écritures non modifiables, corrigées par écriture inverse).*

### Pas à pas

1. **Consulter les états.** Menu **Comptabilité** : mouvements de caisse, dépenses, journal des achats, prêts, soldes des délégués, exportateurs, comptes, factures des fournisseurs, emprunts, prestations, ventes d'autres produits, impôts et estimation du BIC.
2. **Passer une écriture.** Menu **Finances** → onglet *Comptabilité* → nouvelle écriture : journal, date, libellé, lignes (compte, débit ou crédit). Elle doit être **équilibrée**.
3. **Consulter les comptes.** Onglet *Comptes et caisses* : soldes et mouvements ; le bouton **Évolution** d'un compte bancaire montre ce qui y est ajouté et soustrait, avec le solde cumulé. Le **rapprochement bancaire** n'est pas dans les droits du comptable : il est tenu par le responsable financier ou l'administrateur.

### Ce que ce profil ne voit pas

- Cartographie
- Conformité / qualité
- Équipe
- Missions
- Stocks

### Exercices

| # | À faire | Résultat attendu |
|---|---|---|
| 1 | Passez une écriture « Cotisation » : 571 Caisse au débit, 758 Produits divers au crédit, 20 000 F. | L'écriture apparaît au journal ; une écriture déséquilibrée est refusée. |

### Acquis (à cocher)

- [ ] Passer des écritures comptables équilibrées
- [ ] Consulter les comptes et les états
- [ ] Demander l'annulation d'une écriture

---

## 10. Direction

**Niveau 3 — Pilotage** · durée indicative : 1 h 30 · compte de démonstration : `direction@demo.agritrace.test`

Suit l'ensemble de l'activité (lecture) et approuve les demandes d'annulation, les prêts et les écarts.

### Objectifs

- Suivre l'activité (tableau de bord, rapports)
- Approuver ou refuser des demandes d'annulation
- Approuver un prêt

### Ce que vous voyez

![Tableau de bord : les indicateurs affichés dépendent de vos droits.](captures/formation/direction-accueil.png)

*Tableau de bord : les indicateurs affichés dépendent de vos droits.*

![Comptes, caisses et comptabilité (écritures non modifiables, corrigées par écriture inverse).](captures/formation/direction-finances.png)

*Comptes, caisses et comptabilité (écritures non modifiables, corrigées par écriture inverse).*

![Rapports et exports Excel.](captures/formation/direction-rapports.png)

*Rapports et exports Excel.*

![Mes opérations : reçus à imprimer et demandes d'annulation.](captures/formation/direction-operations.png)

*Mes opérations : reçus à imprimer et demandes d'annulation.*

### Pas à pas

1. **Lire le tableau de bord.** Page d'accueil : stocks, finances, alertes selon vos droits.
2. **Décider d'une annulation.** Menu **Mes opérations** → *Demandes d'annulation* → **Traiter**. Vous ne pouvez pas décider de vos propres demandes.
3. **Approuver un prêt.** Menu **Préfinancement** (ou Finances) : ouvrez la demande, vérifiez l'échéancier, approuvez. Le demandeur ne peut pas approuver son propre prêt.

### Ce que ce profil ne voit pas

- Paramètres techniques

### Exercices

| # | À faire | Résultat attendu |
|---|---|---|
| 1 | Approuvez la demande d'annulation en attente de la réception SC000000-2026-BRA-2. | Statut « approuvée » ; le demandeur est notifié. |
| 2 | Ouvrez le rapport Finances et exportez-le vers Excel. | Un fichier .xlsx est téléchargé. |

### Acquis (à cocher)

- [ ] Suivre l'activité (tableau de bord, rapports)
- [ ] Approuver ou refuser des demandes d'annulation
- [ ] Approuver un prêt

---

## 11. Responsable financier

**Niveau 3 — Pilotage** · durée indicative : 2 h · compte de démonstration : `responsable.financier@demo.agritrace.test`

Supervise la caisse, les comptes et les prêts ; approuve les paiements, les corrections et les demandes d'annulation.

### Objectifs

- Superviser caisse et comptes
- Approuver et décaisser des prêts
- Décider des annulations

### Ce que vous voyez

![Tableau de bord : les indicateurs affichés dépendent de vos droits.](captures/formation/responsable_financier-accueil.png)

*Tableau de bord : les indicateurs affichés dépendent de vos droits.*

![Comptes, caisses et comptabilité (écritures non modifiables, corrigées par écriture inverse).](captures/formation/responsable_financier-finances.png)

*Comptes, caisses et comptabilité (écritures non modifiables, corrigées par écriture inverse).*

![Rapprochement bancaire : import du relevé (CSV) et pointage des opérations.](captures/formation/responsable_financier-rapprochement.png)

*Rapprochement bancaire : import du relevé (CSV) et pointage des opérations.*

![Prêts et préfinancements : demande, approbation, décaissement, remboursements.](captures/formation/responsable_financier-prefinancement.png)

*Prêts et préfinancements : demande, approbation, décaissement, remboursements.*

### Pas à pas

1. **Superviser la caisse.** Menu **Finances** : soldes des caisses et comptes, comptabilité.
2. **Importer un relevé bancaire.** Onglet *Rapprochement bancaire* : choisissez le compte, le fichier CSV et associez les colonnes (date, libellé, débit, crédit). Utilisez d'abord la **simulation**.
3. **Pointer.** Les lignes évidentes sont pointées automatiquement (même sens, même montant, ±3 jours, un seul candidat). Pointez les autres à la main.
4. **Approuver puis décaisser un prêt.** Menu **Préfinancement** : approbation avec échéancier, puis décaissement ; enregistrez les remboursements.
5. **Décider d'une annulation.** Menu **Mes opérations** → *Demandes d'annulation*.

### Ce que ce profil ne voit pas

- Cartographie
- Missions

### Exercices

| # | À faire | Résultat attendu |
|---|---|---|
| 1 | Approuvez la demande de prêt de KONE Awa (90 000 F) avec deux échéances. | Le prêt passe à « approuvé » ; l'échéancier est créé. |
| 2 | Importez le relevé de démonstration en simulation puis pour de bon. | Les lignes sont pointées automatiquement ; les écarts restent « non rapprochés ». |

### Acquis (à cocher)

- [ ] Superviser caisse et comptes
- [ ] Approuver et décaisser des prêts
- [ ] Décider des annulations

---

## 12. Responsable de magasin

**Niveau 2 — Gestion** · durée indicative : 1 h 30 · compte de démonstration : `responsable.magasin@demo.agritrace.test`

Gère les magasins, valide les inventaires et les écarts de pesée, ajuste les stocks.

### Objectifs

- Gérer les magasins
- Valider les inventaires et les écarts de pesée
- Ajuster un stock

### Ce que vous voyez

![Tableau de bord : les indicateurs affichés dépendent de vos droits.](captures/formation/responsable_magasin-accueil.png)

*Tableau de bord : les indicateurs affichés dépendent de vos droits.*

![convois](captures/formation/responsable_magasin-convois.png)

*convois*

![Stocks par magasin et par lot, traçabilité du lot.](captures/formation/responsable_magasin-stocks.png)

*Stocks par magasin et par lot, traçabilité du lot.*

![Inventaires : comptage physique, écarts, approbation.](captures/formation/responsable_magasin-inventaire.png)

*Inventaires : comptage physique, écarts, approbation.*

### Pas à pas

1. **Ouvrir un inventaire.** Menu **Inventaire** → *Ouvrir un inventaire* : choisissez le magasin, saisissez les quantités comptées.
2. **Approuver les écarts.** Les écarts sont approuvés par vous ; une correction est un mouvement d'ajustement, jamais une suppression.

### Ce que ce profil ne voit pas

- Caisse et comptabilité
- Finances
- Cartographie

### Exercices

| # | À faire | Résultat attendu |
|---|---|---|
| 1 | Ouvrez un inventaire du Magasin central et comptez 1 940 kg. | Un écart de −10 kg apparaît, en attente d'approbation. |

### Acquis (à cocher)

- [ ] Gérer les magasins
- [ ] Valider les inventaires et les écarts de pesée
- [ ] Ajuster un stock

---

## 13. Responsable de traçabilité

**Niveau 2 — Gestion** · durée indicative : 1 h 30 · compte de démonstration : `responsable.tracabilite@demo.agritrace.test`

Valide les déclarations d'achat, suit les lots et les certificats, contrôle la chaîne de traçabilité.

### Objectifs

- Contrôler les déclarations d'achat
- Remonter la chaîne de traçabilité d'un lot
- Suivre les producteurs

### Ce que vous voyez

![Tableau de bord : les indicateurs affichés dépendent de vos droits.](captures/formation/responsable_tracabilite-accueil.png)

*Tableau de bord : les indicateurs affichés dépendent de vos droits.*

![Liste des producteurs de la coopérative.](captures/formation/responsable_tracabilite-producteurs.png)

*Liste des producteurs de la coopérative.*

![Déclarations d'achat des délégués, à mettre en vérification puis valider.](captures/formation/responsable_tracabilite-declarations.png)

*Déclarations d'achat des délégués, à mettre en vérification puis valider.*

![Fiches d'accompagnement : producteurs des convois et des chargements, export Excel, import et transmission à l'exportateur.](captures/formation/responsable_tracabilite-fiches-accompagnement.png)

*Fiches d'accompagnement : producteurs des convois et des chargements, export Excel, import et transmission à l'exportateur.*

### Pas à pas

1. **Vérifier les déclarations.** Menu **Déclarations d'achat** : les déclarations « Reçue » attendent une mise en vérification, puis validation.
2. **Préparer la fiche d'accompagnement.** Menu **Fiches d'accompagnement** → onglet *Convois pesés* : **Consulter** liste les producteurs d'un convoi (nom, genre, section, code, date de livraison, poids net, sacs, n° de reçu) et **Exporter (Excel)** produit la fiche sur le modèle de la coopérative. Pour un chargement de plusieurs convois, cochez-les puis **Créer la fiche** : renseignez chauffeur, camion, remorque, LOT ID DSE, n° de connaissement, date de départ, type de cacao et certifications. Une fiche déjà remplie ailleurs s'**importe** par *Importer une fiche (Excel)* (les codes absents du registre sont signalés).
3. **Transmettre la fiche à l'exportateur.** Onglet *Fiches d'accompagnement* → **Transmettre à l'exportateur** : choisissez le compte exportateur. La fiche ne peut plus être modifiée, l'exportateur est notifié et la télécharge au format Excel.
4. **Tracer un lot.** Menu **Stocks et lots** (si accessible) ou la fiche du lot : bouton *Traçabilité* pour voir producteurs, parcelles, connaissements et pesées.

### Ce que ce profil ne voit pas

- Caisse et comptabilité
- Finances

### Exercices

| # | À faire | Résultat attendu |
|---|---|---|
| 1 | Mettez en vérification la déclaration de TAPE Joséphine. | Son statut passe à « En vérification ». |
| 2 | Dans **Fiches d'accompagnement**, consultez les producteurs d'un convoi puis exportez la fiche en Excel. | Le fichier reprend le modèle de la coopérative : producteurs, poids net, sacs, n° de reçu et totaux. |
| 3 | Créez la fiche d'un chargement de deux convois et transmettez-la à l'exportateur. | La fiche passe à « Transmise à … » ; l'exportateur la voit dans son menu. |
| 4 | Recherchez un reçu par numéro et retrouvez le producteur. | La fiche du producteur s'affiche avec ses parcelles. |

### Acquis (à cocher)

- [ ] Contrôler les déclarations d'achat
- [ ] Remonter la chaîne de traçabilité d'un lot
- [ ] Suivre les producteurs

---

## 14. Responsable cartographie

**Niveau 2 — Gestion** · durée indicative : 1 h 30 · compte de démonstration : `responsable.cartographie@demo.agritrace.test`

Vérifie les parcelles, traite les anomalies géographiques, gère les couches et les exports cartographiques.

### Objectifs

- Vérifier les parcelles et leurs tracés
- Traiter les anomalies géographiques
- Importer des couches de référence

### Ce que vous voyez

![Tableau de bord : les indicateurs affichés dépendent de vos droits.](captures/formation/responsable_cartographie-accueil.png)

*Tableau de bord : les indicateurs affichés dépendent de vos droits.*

![Parcelles, superficies déclarées, état de vérification et versions du tracé.](captures/formation/responsable_cartographie-parcelles.png)

*Parcelles, superficies déclarées, état de vérification et versions du tracé.*

![Carte, anomalies géographiques et couches de référence.](captures/formation/responsable_cartographie-cartographie.png)

*Carte, anomalies géographiques et couches de référence.*

### Pas à pas

1. **Contrôler une parcelle.** Menu **Parcelles** : ouvrez la fiche, comparez la superficie déclarée à celle du tracé puis lancez le contrôle.
2. **Traiter les anomalies.** Menu **Cartographie** → onglet des anomalies : chevauchements, zones protégées, doublons. Décidez (corriger, justifier, rejeter).
3. **Consulter l'historique du tracé.** Dans la fiche de la parcelle : *Versions du tracé* (auteur, motif, date).

### Ce que ce profil ne voit pas

- Caisse et comptabilité
- Finances
- Stocks

### Exercices

| # | À faire | Résultat attendu |
|---|---|---|
| 1 | Contrôlez la parcelle de KONE Awa. | Le statut de contrôle est mis à jour. |
| 2 | Repérez sur la carte une parcelle sans tracé. | La parcelle de ADJE Sylvain n'a pas de tracé : elle est signalée. |

### Acquis (à cocher)

- [ ] Vérifier les parcelles et leurs tracés
- [ ] Traiter les anomalies géographiques
- [ ] Importer des couches de référence

---

## 15. Cartographe

**Niveau 1 — Opérateur** · durée indicative : 1 h · compte de démonstration : `cartographe@demo.agritrace.test`

Relève et saisit les parcelles, importe les tracés, consulte les anomalies.

### Objectifs

- Saisir ou importer le tracé d'une parcelle
- Consulter les anomalies

### Ce que vous voyez

![Tableau de bord : les indicateurs affichés dépendent de vos droits.](captures/formation/cartographe-accueil.png)

*Tableau de bord : les indicateurs affichés dépendent de vos droits.*

![Parcelles, superficies déclarées, état de vérification et versions du tracé.](captures/formation/cartographe-parcelles.png)

*Parcelles, superficies déclarées, état de vérification et versions du tracé.*

![Carte, anomalies géographiques et couches de référence.](captures/formation/cartographe-cartographie.png)

*Carte, anomalies géographiques et couches de référence.*

### Pas à pas

1. **Créer une parcelle.** Menu **Parcelles** → nouvelle parcelle : producteur, filière, superficie déclarée, tracé (ou import de fichier).
2. **Corriger un tracé.** Modifiez le tracé depuis la fiche ; l'ancienne version est conservée dans *Versions du tracé*.

### Ce que ce profil ne voit pas

- Caisse et comptabilité
- Finances
- Stocks
- Équipe

### Exercices

| # | À faire | Résultat attendu |
|---|---|---|
| 1 | Ajoutez le tracé de la parcelle de ADJE Sylvain. | La parcelle n'est plus signalée « sans tracé ». |

### Acquis (à cocher)

- [ ] Saisir ou importer le tracé d'une parcelle
- [ ] Consulter les anomalies

---

## 16. Agent de terrain

**Niveau 1 — Opérateur** · durée indicative : 1 h 30 · compte de démonstration : `agent.terrain@demo.agritrace.test`

Enregistre les producteurs et les données de terrain, exécute les missions qui lui sont confiées.

### Objectifs

- Enregistrer un producteur
- Exécuter une mission
- Saisir un relevé de terrain (même hors connexion)

### Sur le téléphone

<table class="phones"><tr><td><img src="captures/mobile/coach-accueil.png" alt="coach-accueil"></td><td><img src="captures/mobile/coach-modules-formation.png" alt="coach-modules-formation"></td><td><img src="captures/mobile/coach-module-exportateur.png" alt="coach-module-exportateur"></td><td><img src="captures/mobile/coach-module-resultats.png" alt="coach-module-resultats"></td></tr></table>

### Pas à pas

1. **Se connecter.** **Application mobile uniquement** : ce compte est refusé sur le portail web (message « Ce compte se connecte uniquement par l'application mobile »).
2. **Enregistrer un producteur.** Application → **Producteurs** → nouveau : nom, prénoms, village, section, téléphone, filière. Recherche par nom ou code et filtre par section.
3. **Exécuter une mission.** Fiche du producteur → onglet **Tâches** : suivez les instructions, joignez des preuves (photos). Une tâche terminée et validée par l'ADG est grisée, non cliquable, puis disparaît de la liste après le délai fixé par l'ADG.
4. **Saisir un relevé.** Formation, infrastructure sociale ou distribution. La saisie fonctionne hors connexion et se synchronise ensuite.

### Ce que ce profil ne voit pas

- Caisse et comptabilité
- Finances
- Stocks
- Équipe

### Exercices

| # | À faire | Résultat attendu |
|---|---|---|
| 1 | Enregistrez un nouveau producteur fictif dans le village de Hiré. | Il apparaît dans la liste, filière Cacao. |
| 2 | Exécutez la mission « Visite de la parcelle de Awa KONE ». | La mission passe en attente de validation ; une fois validée par l'ADG, elle est grisée dans la liste. |

### Acquis (à cocher)

- [ ] Enregistrer un producteur
- [ ] Exécuter une mission
- [ ] Saisir un relevé de terrain (même hors connexion)

---

## 17. Responsable qualité

**Niveau 2 — Gestion** · durée indicative : 1 h 30 · compte de démonstration : `responsable.qualite@demo.agritrace.test`

Gère les contrôles qualité, les inspections et les documents de conformité.

### Objectifs

- Définir des règles de qualité
- Réaliser une inspection
- Suivre les certificats

### Ce que vous voyez

![Tableau de bord : les indicateurs affichés dépendent de vos droits.](captures/formation/responsable_qualite-accueil.png)

*Tableau de bord : les indicateurs affichés dépendent de vos droits.*

![Qualité : règles, inspections, certificats.](captures/formation/responsable_qualite-qualite.png)

*Qualité : règles, inspections, certificats.*

### Pas à pas

1. **Définir une règle.** Menu **Qualité** → règles : code, libellé, seuil (ex. humidité ≤ 8 %), bloquante ou non.
2. **Inspecter un lot.** Créez une inspection sur le lot, démarrez-la, saisissez les résultats puis terminez avec un résumé.

### Ce que ce profil ne voit pas

- Caisse et comptabilité
- Finances

### Exercices

| # | À faire | Résultat attendu |
|---|---|---|
| 1 | Inspectez le lot LOT-CACAO-2026-00001 avec une humidité de 9,1 %. | Le résultat est non conforme (seuil 8 %) et bloquant. |

### Acquis (à cocher)

- [ ] Définir des règles de qualité
- [ ] Réaliser une inspection
- [ ] Suivre les certificats

---

## 18. Responsable logistique

**Niveau 2 — Gestion** · durée indicative : 1 h · compte de démonstration : `responsable.logistique@demo.agritrace.test`

Planifie les transports et les expéditions, suit les documents d'export.

### Objectifs

- Suivre les expéditions et commandes
- Consulter les stocks et documents d'export

### Ce que vous voyez

![Tableau de bord : les indicateurs affichés dépendent de vos droits.](captures/formation/responsable_logistique-accueil.png)

*Tableau de bord : les indicateurs affichés dépendent de vos droits.*

![Stocks par magasin et par lot, traçabilité du lot.](captures/formation/responsable_logistique-stocks.png)

*Stocks par magasin et par lot, traçabilité du lot.*

### Pas à pas

1. **Suivre les commandes.** Commandes et expéditions selon vos droits ; documents joints aux dossiers d'export.

### Ce que ce profil ne voit pas

- Caisse et comptabilité
- Cartographie

### Exercices

| # | À faire | Résultat attendu |
|---|---|---|
| 1 | Repérez la commande de démonstration et son acheteur. | Le contrat CT-DEMO-001 et la commande associée sont visibles. |

### Acquis (à cocher)

- [ ] Suivre les expéditions et commandes
- [ ] Consulter les stocks et documents d'export

---

## 19. Auditeur

**Niveau 3 — Contrôle** · durée indicative : 1 h · compte de démonstration : `auditeur@demo.agritrace.test`

Consulte en lecture seule les opérations, les journaux d'audit et les états comptables ; ne modifie rien.

### Objectifs

- Consulter sans rien modifier
- Retrouver un fait dans le journal d'audit

### Ce que vous voyez

![Tableau de bord : les indicateurs affichés dépendent de vos droits.](captures/formation/auditeur-accueil.png)

*Tableau de bord : les indicateurs affichés dépendent de vos droits.*

![Comptes, caisses et comptabilité (écritures non modifiables, corrigées par écriture inverse).](captures/formation/auditeur-finances.png)

*Comptes, caisses et comptabilité (écritures non modifiables, corrigées par écriture inverse).*

![Rapports et exports Excel.](captures/formation/auditeur-rapports.png)

*Rapports et exports Excel.*

### Pas à pas

1. **Naviguer en lecture seule.** Tous les écrans sont consultables ; aucun bouton de saisie n'est proposé.
2. **Exporter un rapport.** Menu **Rapports** : export Excel pour vos propres analyses.

### Ce que ce profil ne voit pas

- Tout ce qui permet de saisir ou de modifier

### Exercices

| # | À faire | Résultat attendu |
|---|---|---|
| 1 | Tentez de modifier une écriture comptable. | Impossible : aucun bouton de modification n'est offert. |

### Acquis (à cocher)

- [ ] Consulter sans rien modifier
- [ ] Retrouver un fait dans le journal d'audit

---

## 20. Acheteur / partenaire externe

**Niveau 1 — Partenaire externe** · durée indicative : 45 min · compte de démonstration : `acheteur@demo.agritrace.test`

Partenaire autorisé : consulte les commandes, les expéditions et les documents qui le concernent.

### Objectifs

- Consulter ses commandes, expéditions et documents

### Ce que vous voyez

![Tableau de bord : les indicateurs affichés dépendent de vos droits.](captures/formation/acheteur-accueil.png)

*Tableau de bord : les indicateurs affichés dépendent de vos droits.*

![Commerce : acheteurs, contrats, commandes.](captures/formation/acheteur-commerce.png)

*Commerce : acheteurs, contrats, commandes.*

### Pas à pas

1. **Consulter ses commandes.** Menu **Commerce** : seules vos commandes et vos documents sont visibles.

### Ce que ce profil ne voit pas

- Tout sauf ses commandes, expéditions et documents

### Exercices

| # | À faire | Résultat attendu |
|---|---|---|
| 1 | Ouvrez la commande de démonstration. | Vous voyez la ligne « Cacao fèves — 2 000 kg ». |

### Acquis (à cocher)

- [ ] Consulter ses commandes, expéditions et documents

---

## 21. Administrateur de groupe (ADG)

**Niveau 3 — Pilotage** · durée indicative : 2 h · compte de démonstration : `adg@demo.agritrace.test`

Responsable de la conformité et de la certification : suit les certificats, les inspections et la qualité, contrôle et vérifie les parcelles, met en place les missions des coachs et décide de leurs demandes.

### Objectifs

- Suivre la conformité et les certificats
- Mettre en place les missions des coachs
- Décider de leurs demandes

### Ce que vous voyez

![Tableau de bord : les indicateurs affichés dépendent de vos droits.](captures/formation/adg-accueil.png)

*Tableau de bord : les indicateurs affichés dépendent de vos droits.*

![Modules de formation : bibliothèque préchargée (cacao puis café), à conserver, modifier ou supprimer.](captures/formation/adg-modules-formation.png)

*Modules de formation : bibliothèque préchargée (cacao puis café), à conserver, modifier ou supprimer.*

![Modules des exportateurs : propositions à transmettre aux coachs, ou suivi de ses propres propositions.](captures/formation/adg-modules-exportateurs.png)

*Modules des exportateurs : propositions à transmettre aux coachs, ou suivi de ses propres propositions.*

![Résultats saisis par les coachs, à transmettre à l'exportateur.](captures/formation/adg-resultats-exportateurs.png)

*Résultats saisis par les coachs, à transmettre à l'exportateur.*

### Pas à pas

1. **Suivre les certificats.** Rapports et alertes : le certificat de démonstration expire dans moins de 30 jours.
2. **Créer et affecter une mission.** Menu **Missions** : titre, catégorie, priorité, échéance, producteur, coach assigné, critères de validation ; publiez.
3. **Valider le résultat.** Revoyez les preuves transmises par le coach puis validez ou demandez une correction. Une tâche validée est grisée ; elle disparaît de la liste après le nombre de jours réglé en haut de la page *Missions* (« Jours de visibilité des missions validées », 7 par défaut).
4. **Transmettre les modules des exportateurs.** Menu **Modules des exportateurs** → onglet *Propositions* : lisez le module puis cliquez **Transmettre aux coachs** : une fenêtre demande la **nature** (module de formation, distribution ou tâche) et la **cible** (tous les producteurs, ou certains : recherche par nom/code et filtre par section), avec échéance et consigne facultatives. L'élément s'ajoute au profil de chaque producteur ciblé. Vous pouvez aussi **Décliner** (motif facultatif). Le contenu est transmis **tel que proposé** : l'ADG ne peut pas le modifier. Le module apparaît alors dans la bibliothèque des coachs, marqué « Proposé par … ».
5. **Affecter un modèle aux producteurs.** Onglet *Affectations aux producteurs* → **Affecter un modèle** : choisissez la nature (module de la bibliothèque, distribution ou tâche libre), tous les producteurs ou certains, une échéance et une consigne. Le tableau montre, pour chaque affectation, le nombre de producteurs ciblés et l'avancement (faits / total). Le nom d'un producteur, dans *Producteurs*, ouvre son profil avec ces éléments.
6. **Transmettre les résultats à l'exportateur.** Onglet *Résultats* : les coachs envoient d'abord leurs résultats à l'ADG (date, village, participants, score moyen, observations). Cliquez **Transmettre à l'exportateur** : les résultats sont transmis **tels que saisis**, sans modification possible.
7. **Gérer les modules de formation.** Menu **Modules de formation** : une bibliothèque agricole (cacao en priorité, puis café) liée aux certifications est préchargée. Pour chaque module : *Conserver* (validé tel quel), *Modifier* ou *Supprimer*. *Rétablir les modules par défaut* ne rajoute que les modules supprimés. Le contenu fourni est un socle général : adaptez-le à votre cahier des charges de certification.

### Ce que ce profil ne voit pas

- Caisse et comptabilité
- Finances
- Convois (réception et règlement)
- Stocks
- Préfinancement

### Exercices

| # | À faire | Résultat attendu |
|---|---|---|
| 1 | Créez une mission de formation et assignez-la au coach. | Le coach la voit dans ses missions (application mobile). |
| 2 | Dans **Modules des exportateurs**, transmettez la proposition en attente aux coachs, puis transmettez à l'exportateur le résultat reçu du coach. | La proposition passe « Transmise aux coachs » ; le résultat est marqué « Transmis ». Aucun champ n'a été modifié. |
| 3 | Dans **Modules de formation**, modifiez un module cacao puis supprimez un module café. | Le module modifié est marqué « Modifié » ; le coach ne voit plus le module supprimé après actualisation. |

### Acquis (à cocher)

- [ ] Suivre la conformité et les certificats
- [ ] Mettre en place les missions des coachs
- [ ] Décider de leurs demandes

---

## 22. Coach

**Niveau 1 — Opérateur** · durée indicative : 2 h · compte de démonstration : `coach@demo.agritrace.test`

Agent de terrain suivi par l'ADG : exécute ses missions, enregistre des producteurs, relève des parcelles, des infrastructures sociales, des formations et des distributions, joint des photos et demande de nouvelles missions.

### Objectifs

- Exécuter ses missions
- Rechercher et filtrer les producteurs par section
- Consulter les modules de formation
- Enregistrer producteurs, parcelles et relevés

### Sur le téléphone

<table class="phones"><tr><td><img src="captures/mobile/coach-accueil.png" alt="coach-accueil"></td><td><img src="captures/mobile/coach-modules-formation.png" alt="coach-modules-formation"></td><td><img src="captures/mobile/coach-module-exportateur.png" alt="coach-module-exportateur"></td><td><img src="captures/mobile/coach-module-resultats.png" alt="coach-module-resultats"></td></tr></table>

### Pas à pas

1. **Se connecter.** **Application mobile uniquement** : ce compte est refusé sur le portail web.
2. **Trouver un producteur.** Application → **Producteurs** : tapez un nom, un code ou un village, et touchez une *section* pour ne voir que ses producteurs.
3. **Lire un module de formation.** Application → **Modules de formation** : filtrez par culture (cacao, café) ou par thème, ouvrez un module (objectifs, points à enseigner, erreurs à éviter, questions de vérification). Les modules sont conservés sur le téléphone pour être lus sans réseau.
4. **Dispenser un module d'exportateur et saisir ses résultats.** Un module marqué « Proposé par … » vient d'un exportateur (transmis par l'ADG). Après la séance, ouvrez le module → **Saisir les résultats** : date, village, participants, score moyen (facultatif), observations (conservés sur le téléphone puis envoyés à la synchronisation). L'envoi demande une connexion ; les résultats vont à l'ADG et ne sont plus modifiables. *Mes résultats saisis* indique s'ils ont été transmis à l'exportateur.
5. **Voir ce que l'ADG a ajouté au profil.** Fiche du producteur → onglet *Liste des tâches* : sous « Formations, distributions et tâches », les éléments ajoutés par l'Administrateur de groupe (nature, échéance, consigne). Touchez **Fait** une fois réalisé : l'élément est grisé, conservé sur le téléphone et envoyé à la synchronisation (réseau non nécessaire sur le moment).
6. **Lire ses missions.** Fiche du producteur → **Tâches** : instructions, échéance, résultat attendu. Les tâches terminées et validées sont grisées.
7. **Saisir un relevé.** Formations, infrastructures sociales, distributions (liste de bénéficiaires, articles) avec photos.

### Ce que ce profil ne voit pas

- Caisse et comptabilité
- Finances
- Convois
- Stocks
- Équipe

### Exercices

| # | À faire | Résultat attendu |
|---|---|---|
| 1 | Saisissez une formation de 12 participants à Hiré. | Le relevé apparaît dans **Relevés de terrain** (portail de l'ADG) après synchronisation. |
| 2 | Filtrez les producteurs sur la section Est, puis ouvrez le module « Fermentation du cacao ». | La liste est réduite à la section ; le module s'ouvre, même sans réseau après une première ouverture. |

### Acquis (à cocher)

- [ ] Exécuter ses missions
- [ ] Rechercher et filtrer les producteurs par section
- [ ] Consulter les modules de formation
- [ ] Enregistrer producteurs, parcelles et relevés

---

## 23. Exportateur (partenaire)

**Niveau 1 — Opérateur** · durée indicative : 1 h · compte de démonstration : `exportateur@demo.agritrace.test`

Partenaire exportateur : propose des modules de formation à l'ADG reçoit, par l'ADG, les résultats obtenus par les coachs sur ces modules, et consulte les fiches d'accompagnement que le responsable de traçabilité lui transmet.

### Objectifs

- Proposer un module de formation à l'ADG
- Suivre le sort de ses propositions
- Consulter les résultats transmis par l'ADG

### Ce que vous voyez

![Tableau de bord : les indicateurs affichés dépendent de vos droits.](captures/formation/exportateur-accueil.png)

*Tableau de bord : les indicateurs affichés dépendent de vos droits.*

![Modules des exportateurs : propositions à transmettre aux coachs, ou suivi de ses propres propositions.](captures/formation/exportateur-modules-exportateurs.png)

*Modules des exportateurs : propositions à transmettre aux coachs, ou suivi de ses propres propositions.*

![Fiches d'accompagnement : producteurs des convois et des chargements, export Excel, import et transmission à l'exportateur.](captures/formation/exportateur-fiches-accompagnement.png)

*Fiches d'accompagnement : producteurs des convois et des chargements, export Excel, import et transmission à l'exportateur.*

### Pas à pas

1. **Voir son accueil.** Le **tableau de bord** affiche quatre indicateurs : propositions en attente de l'ADG, transmises aux coachs, non retenues, résultats reçus (avec le total de participants). Les **messages** et les **notifications** s'ouvrent par les icônes en haut à droite (enveloppe et cloche), pas par le menu.
2. **Proposer un module.** Menu **Modules des exportateurs** → **Proposer un module** : titre, thème, résumé, cultures, certifications, objectifs, sections (titre et points), points à éviter, questions de vérification. Une fois envoyé, le module **n'est plus modifiable** : en cas d'erreur, proposez-en un nouveau.
3. **Suivre sa proposition.** Le statut passe de « En attente de l'ADG » à « Transmis aux coachs » ou « Non retenu » (avec le motif de l'ADG). Vous êtes notifié à chaque étape.
4. **Consulter les fiches d'accompagnement.** Menu **Fiches d'accompagnement** : les fiches que le responsable de traçabilité vous a transmises (chargement, connaissement, camion, poids, sacs). **Consulter** affiche les producteurs du chargement, **Télécharger (Excel)** donne le fichier. Vous êtes notifié à chaque nouvelle fiche et ne voyez que celles qui vous sont destinées.
5. **Lire les résultats.** Une fois la séance faite, les coachs envoient leurs résultats à l'ADG, qui vous les transmet **tels que saisis** : séance, village, participants, score moyen, observations. Vous ne voyez que les résultats de vos propres modules, jamais les autres données de la coopérative.

### Ce que ce profil ne voit pas

- Tout sauf ses propositions de modules et les résultats que l'ADG lui a transmis

### Exercices

| # | À faire | Résultat attendu |
|---|---|---|
| 1 | Proposez le module « Séchage des fèves » (un objectif, une section). | La proposition apparaît « En attente de l'ADG ». |
| 2 | Ouvrez la fiche d'accompagnement reçue puis téléchargez-la. | Vous voyez les producteurs du chargement ; le fichier Excel suit le modèle de la coopérative. |
| 3 | Ouvrez les résultats du module « Carnet de récolte et traçabilité ». | Vous voyez la séance de Hiré (22 participants, score 78) et non celle de Zégban, tant que l'ADG ne l'a pas transmise. |

### Acquis (à cocher)

- [ ] Proposer un module de formation à l'ADG
- [ ] Suivre le sort de ses propositions
- [ ] Consulter les résultats transmis par l'ADG

---

## 24. Évaluation finale (30 min)

Scénario commun, à dérouler à plusieurs comptes :

1. **Délégué** : déclare un achat et crée un connaissement (numéro attribué automatiquement).
2. **Magasinier** : réceptionne le connaissement (poids différent du déclaré) et imprime le reçu.
3. **Caissier** : règle le connaissement au prix du jour.
4. **Comptable** : passe l'écriture correspondante et pointe le relevé.
5. **Magasinier** : constate une erreur de poids et demande l'annulation.
6. **Direction ou administrateur** : décide de la demande.
7. **Auditeur** : retrouve l'ensemble des traces (reçus, demande, décision).

Critères : respect du circuit, aucune suppression, motifs renseignés, reçus imprimés, demandeur ≠ approbateur.
