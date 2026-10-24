# Données personnelles — registre et mesures (modèle à faire valider par un juriste)

**Ce document décrit ce que fait le logiciel ; il ne remplace pas un avis juridique.** Les textes applicables (en Côte d'Ivoire : loi n° 2013-450 relative à la protection des données à caractère personnel et autorité de protection ARTCI ; selon les marchés, RGPD de l'Union européenne pour les acheteurs européens et le règlement EUDR) doivent être confrontés à votre situation par un juriste.

## 1. Données traitées
| Catégorie | Exemples | Finalité | Accès |
|---|---|---|---|
| Identité des producteurs | nom, village, section, téléphone, code producteur | traçabilité, paiements | rôles `producers:*` |
| Localisation | parcelles, tracés GPS | conformité EUDR, anti-déforestation | rôles `parcels:*`, `geo:*` |
| Pièces justificatives | pièces d'identité, contrats (documents sensibles) | contrôle, audit | `documents:read`, `documents:sensitive` |
| Données financières | achats, paiements, prêts, emprunts, factures des fournisseurs, impôts | gestion, comptabilité | rôles finance/comptabilité |
| Coordonnées bancaires et pièce d'identité des délégués | banque, n° de compte, type et n° de pièce | paiement et identification des délégués | `collectors:read`, rôles caisse/comptabilité |
| Tiers (partenaires, fournisseurs, clients, prêteurs) | nom, téléphone, courriel, adresse, n° de contribuable | gestion des relations et des règlements | `partners:read` |
| Comptes utilisateurs | e-mail, nom, rôle, journaux de connexion | accès, sécurité | administrateurs |

## 2. Mesures techniques en place
Cloisonnement strict entre coopératives (sécurité par ligne), droits par rôle, journal d'audit non modifiable, chiffrement des échanges (HTTPS), mots de passe hachés (argon2id), double authentification, chiffrement des documents au repos (`DOCUMENTS_KEY`), base mobile chiffrée (SQLCipher) purgée à la révocation, sauvegardes chiffrables, téléchargements de documents sensibles journalisés.

## 2 bis. Échanges entre organisations
La transmission d'une fiche d'accompagnement à une organisation liée (exportateur ou autre coopérative) copie la liste des producteurs (noms, codes, poids) chez le destinataire. Le lien est accepté par les deux parties et révocable ; la durée de conservation chez le destinataire est à fixer par contrat (voir EXPORTATEUR.md).

## 3. À décider et à documenter par la coopérative
1. **Base légale et consentement** : recueillir et conserver la preuve du consentement des producteurs (collecte des données, photos, tracés GPS) ; informer sur les finalités et les destinataires (acheteurs, certificateurs).
2. **Durées de conservation** : le champ `retention_until` existe sur chaque document ; fixer une durée par catégorie (ex. pièces d'identité : durée de la relation + délai légal) et purger à l'échéance.
3. **Droits des personnes** (accès, rectification, suppression, opposition) : désigner un responsable, définir la procédure ; aucune fonction dédiée d'export ou d'effacement par personne n'existe aujourd'hui (à traiter au cas par cas par l'équipe technique) ; la suppression ne doit pas casser la traçabilité exigée par la loi : arbitrage à faire avec le juriste.
4. **Déclaration / autorisation** auprès de l'autorité compétente si la loi l'exige ; désignation d'un délégué ou responsable du traitement.
5. **Transferts hors du pays** (hébergement, acheteurs étrangers) : clauses contractuelles et information.
6. **Violation de données** : procédure de notification (voir `SECURITE.md`, « En cas d'incident ») et délais légaux.
7. **Contrats** avec l'hébergeur et les sous-traitants.
