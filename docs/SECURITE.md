# Sécurité — état et limites

**En place (testé)** : authentification JWT courte + jeton de renouvellement tournant, mots de passe argon2id, permissions par organisation contrôlées côté serveur, sécurité par ligne PostgreSQL (rôle applicatif non propriétaire), journal d'audit et écritures financières/comptables non modifiables (déclencheurs), clés d'idempotence, validation stricte des entrées, limiteur de débit, en-têtes helmet, contrôle du type réel des fichiers (octets magiques) et empreinte SHA-256, téléchargements journalisés, métriques protégées par jeton.

**Non fait / à faire avant production réelle**
- Audit de sécurité indépendant et test d'intrusion.
- Stockage objet chiffré pour les documents (aujourd'hui disque local) ; analyse antivirus.
- Chiffrement au repos de la base et des sauvegardes (à fournir par l'hébergeur ou le système).
- Authentification à deux facteurs, verrouillage progressif des comptes, politique de mots de passe configurable.
- Révocation d'appareil depuis l'interface ; effacement à distance du mobile.
- Gestion des secrets via un coffre (aujourd'hui variables d'environnement).
- Conformité aux textes sur les données personnelles applicables (consentement, durées de conservation, droits des personnes) : à valider avec un juriste.
- Analyse de dépendances en continu (Dependabot / `npm audit`).
