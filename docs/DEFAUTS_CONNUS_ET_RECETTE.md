# Défauts connus et plan de recette (CDC §33, §35, §36)

Document de suivi tenu à jour avec `ECARTS_CDC.md`. Il répond à trois questions : ce qui manque, ce qui n'est pas encore prouvé, ce qu'il faut décider avec la coopérative avant la mise en production.

## 1. Fonctions manquantes
| Sujet | CDC | État | Pour avancer |
|---|---|---|---|
| Notifications push et courriel | §25 | Aucune poussée distante : le mobile ne reçoit les notifications qu'avec du réseau | Projet Firebase (clés `google-services.json` et compte de service) |
| Import de relevés bancaires, Mobile Money | §21.1 | Rapprochement des paiements disponible ; aucun import de relevé ni connexion opérateur | Format de relevé de la banque, accès opérateur ; ne pas déclarer opérationnel sans test réel (§36) |
| Envoi automatique des rapports | §26 | Rapports et export Excel à la demande | Choix des destinataires et de la fréquence |
| Import lourd (limite 5 000 objets par fichier) | §31 | Traitement en arrière-plan avec progression consultable (testé) | Mesurer sur des volumes réels ; découpage des très gros fichiers |
| Versions de géométrie en table dédiée | §8.6 | Historique conservé par le journal des modifications | Table `parcel_geometry_versions` si l'audit l'exige |
| Systèmes de coordonnées de l'import de parcelles | §9.3 | WGS84 et UTM sur WGS84 (conversion vérifiée) ; Web Mercator pour les couches de zones protégées ; datums locaux refusés | Transformation de datum (Abidjan 1987) si la coopérative en reçoit |
| Postes de bureau hors connexion | §27 | Achats et messages seulement ; pas de validation, paiements ni stocks | À arbitrer avec la coopérative |
| Carte du portail web | §8 | Fonds Plan/Satellite en ligne livrés ; pas de dessin à la souris, pas de fond hors ligne | Fournisseur de tuiles sous contrat si le trafic grandit |
| Couches de zones protégées sur les appareils | §10 | Contrôle côté serveur seulement | Réplication des couches (licence WDPA à régler d'abord) |

## 2. Non prouvé à ce jour (§33, §36)
- Application Android compilée et installée sur un appareil réel : vérifiée par les tests et la CI seulement.
- Installateur Windows `.exe` : construit par le workflow GitHub, jamais exécuté ; pas de signature de code.
- Tests de charge (§32) : non réalisés, aucun objectif chiffré défini.
- Restauration réelle d'une sauvegarde de production (§33.10) : le script `scripts/restore-test.sh` existe ; la preuve d'une restauration jouée sur les données de la coopérative manque.
- Audit de sécurité indépendant ; avis `npm audit` sur des dépendances transitives de NestJS à suivre.
- Purge des données à la révocation : décision testée, requête SQL non exercée hors appareil.
- Recette avec les utilisateurs de chaque rôle principal (§33.11).

## 3. Décisions à confirmer avec la coopérative (§36)
Mode de numérotation des reçus · règles d'annulation et de correction des achats · seuils de tolérance de pesée · procédure de réception · règles de stock et de lots · avances et paiements · exigences comptables et juridiques · politique de protection des données · exigences de conformité par filière · tolérances géométriques et règles de validation des chevauchements · conditions de remplacement des doublons · partage des données géographiques entre coopératives · responsabilités exactes de l'ADG · capacité d'hébergement et de synchronisation · licence des couches de zones protégées (WDPA : usage non commercial sauf autorisation de l'UNEP-WCMC).

## 4. Livrables du §35 : état
Présents : code (mobile, web, serveur, bureau), migrations, tests automatisés (e2e, unitaires, navigateur), jeux de données de démonstration (`seed-demo.js`), procédures de déploiement et d'exploitation, règles de synchronisation, documentation des API (Swagger), prototype cliquable.
Produits depuis : guide utilisateur par rôle (PDF, avec captures, portail et mobile) et matrice des rôles et permissions (PDF).
À produire : guide administrateur dédié, supports de formation, rapports de tests (fonctionnels, géographiques, sécurité), rapport de recette, plan de maintenance.

## 5. Scénarios de recette proposés
Un scénario par ligne du §33, joué par un utilisateur du rôle concerné sur des données de la coopérative : multi-coopératives (33.1), import producteurs avec codes à zéros initiaux (33.2), parcelles créées en parallèle (33.3), cinq formats en import et export (33.4), chevauchements et doublons (33.5), missions (33.6), achat avec reçu et synchronisation hors connexion (33.7), réception partielle, transfert, lots (33.8), caisses simultanées et clôture (33.9), suspension d'un compte sur un téléphone, sauvegarde puis restauration (33.10). Chaque défaut relevé est classé bloquant / majeur / mineur, corrigé, puis retesté.

## 6. Vérification du cahier des charges du 21 octobre 2026
Méthode : relecture des 38 sections, puis tests rejoués (et non reportés de la documentation).
- Tests rejoués ce jour : 22 scripts de bout en bout API sur 23 (tous réussis, 0 échec ; `e2e-replication` n'a pas été rejoué : il exige ses propres bases, dernier résultat connu 78 contrôles), 65 tests unitaires serveur, 10 tests portail, 57 tests mobile.
- **Couvert** : multi-coopératives et isolation (RLS), producteurs et import, filières/campagnes/prix versionnés, parcelles (5 formats, doublons, chevauchements, remplacement contrôlé, zones protégées), missions, achats et reçus, pesée/réception, stocks, lots et généalogie, transport/ventes, caisses, comptabilité, préfinancement, qualité/conformité/documents, notifications, hors connexion et synchronisation, audit, rapports, application de bureau local/central.
- **Écarts restants constatés (fonctionnels)**
  1. ~~**Changement et réinitialisation de mot de passe (§5.3)**~~ **Traité le 21 octobre 2026** (voir ECARTS_CDC.md, section « Annulations, reçus, mot de passe, profil »). Texte d'origine : aucune route (seulement connexion, rafraîchissement, déconnexion). Un utilisateur ne peut pas changer le mot de passe fixé par l'administrateur, et il n'y a pas de procédure de réinitialisation.
  2. ~~**Rôles types (§5.1)**~~ **Traité** : 17 modèles. Texte d'origine : 5 modèles prêts (magasinier, caissier, collecteur, ADG, coach) plus l'administrateur de coopérative sur 19 rôles listés ; les autres (direction, responsable traçabilité, responsable cartographie, cartographe, agent de terrain, responsable de magasin, responsable financier, comptable, responsable qualité, responsable logistique, auditeur) se composent à la main permission par permission ; l'acheteur ou partenaire externe n'a pas d'accès.
  3. **Fiche de la coopérative (§4.1)** — *partiellement traité* : nom commercial, adresse, téléphone, e-mail, devise et langue sont désormais saisissables ; filières exploitées et documents administratifs ne le sont pas. Texte d'origine : seuls code, nom, pays et (désormais) logo existent ; ni nom commercial, adresse, contacts, devise de référence, langue par défaut, filières exploitées ni documents administratifs ne sont saisissables.
  4. **Paramètres (§4.2)** : réglables aujourd'hui — séries et règles des reçus, tolérance de pesée et de convoi, règles de chevauchement, postes obligatoires, modèles de saisie du terrain. Non réglables — sections et villages (champs texte libres, pas de référentiel), unités de mesure (conversion fixe), formats des codes producteurs, documents obligatoires, circuits d'approbation configurables, méthodes de paiement, modèles de reçus et de rapports.
  5. **Affectation des utilisateurs (§5.3)** à une section, zone, filière ou équipe : prévue pour les collecteurs (filières) ; pas d'équipe ni de zone administrable pour les autres rôles.
  6. Écarts déjà listés plus haut (poussée de notifications, relevés bancaires, rapports automatiques, versions de géométrie en table dédiée, postes de bureau hors connexion, couches de zones protégées sur appareil).
- **Non prouvé** (inchangé) : Android réel, installateur Windows, charge (le script `scripts/load-test.js` existe, aucun objectif chiffré ni mesure), restauration réelle, audit de sécurité indépendant, recette avec les utilisateurs.
- Remarque : les fonctions « infrastructures sociales, formations, distribution et services », modèles de saisie et logo de coopérative dépassent le cahier des charges (demandes ultérieures) ; elles n'ont pas de section dans le CDC.
