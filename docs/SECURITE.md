# Sécurité — état et limites

**En place (testé)** : authentification JWT courte + jeton de renouvellement tournant, mots de passe argon2id, permissions par organisation contrôlées côté serveur, sécurité par ligne PostgreSQL (rôle applicatif non propriétaire), journal d'audit et écritures financières/comptables non modifiables (déclencheurs), clés d'idempotence, validation stricte des entrées, limiteur de débit, en-têtes helmet, contrôle du type réel des fichiers (octets magiques) et empreinte SHA-256, téléchargements journalisés, métriques protégées par jeton.

**Non fait / à faire avant production réelle**
- Audit de sécurité indépendant et test d'intrusion.
- Stockage objet chiffré pour les documents (aujourd'hui disque local) ; analyse antivirus.
- Chiffrement au repos de la base et des sauvegardes (à fournir par l'hébergeur ou le système).
- Authentification à deux facteurs, verrouillage progressif des comptes, politique de mots de passe configurable.
- Révocation d'appareil depuis l'interface ; effacement à distance du mobile. La suspension d'un compte, le changement de rôle et la révocation des sessions existent en API (blocage immédiat du jeton) ; l'application mobile ne purge pas encore ses données locales.
- Gestion des secrets via un coffre (aujourd'hui variables d'environnement).
- Conformité aux textes sur les données personnelles applicables (consentement, durées de conservation, droits des personnes) : à valider avec un juriste.
- Analyse de dépendances en continu (Dependabot / `npm audit`).

## Procédure de révocation d'un accès (CDC §27.7)
1. `POST /users/:id/suspend` (permission `users:suspend`, motif obligatoire) : l'accès à la coopérative est refusé à la requête suivante ; les sessions sont révoquées si la personne n'a aucun autre accès actif.
2. Appareil perdu : `POST /users/:id/revoke-sessions`. La personne doit se reconnecter ; l'appareil reçoit 401/403 et la synchronisation se bloque.
3. Changement de droits : `POST /users/:id/role` (rôle de la même coopérative, permissions limitées à celles de l'auteur) ; effet immédiat.
4. Tout est tracé (`user_access_events`, audit) ; au moins un administrateur actif doit toujours rester.

## Dépendances et fonctions expérimentales
- `npm audit` signale des avis dans des dépendances transitives de NestJS ; à suivre via Dependabot.
- GeoPackage utilise `node:sqlite` (expérimental dans Node 22) ; fichiers traités en mémoire uniquement, archives limitées en taille et en nombre d'entrées, DOCTYPE/ENTITY XML refusés.
