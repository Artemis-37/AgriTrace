# AgriTrace Mobile (Android, hors connexion)

Application Flutter pour les collecteurs : saisie des déclarations d'achat sans Internet, file d'attente persistante, synchronisation bidirectionnelle avec l'API (`/v1/sync/batch` et `/v1/sync/changes`).

> **État** : le code passe `flutter analyze` (0 erreur ; 4 avertissements de dépréciation liés aux versions récentes de Flutter) et les 8 tests unitaires de la logique de synchronisation (Flutter 3.47 / Dart 3.13). **Non vérifié** : la compilation de l'APK (le build Gradle n'a pu télécharger ses dépendances dans l'environnement de développement ; le job `mobile` de la CI la fait) et tout essai sur émulateur ou téléphone. Le serveur de synchronisation est testé de bout en bout.

## Premier lancement

```bash
cd mobile
flutter create --platforms=android --org ci.agritrace .   # génère le dossier android/ (sans toucher à lib/)
flutter pub get
flutter test                                              # tests de la logique de synchronisation
flutter run --dart-define=API_BASE=http://10.0.2.2:3000/v1
```

Dans `android/app/build.gradle`, `minSdkVersion` doit être **21 ou plus** (SQLCipher).
Pour une API en HTTP (développement uniquement), autoriser le trafic en clair dans `AndroidManifest.xml` ; en production, HTTPS obligatoire.

## Fonctionnement

- **Base locale chiffrée** (SQLCipher). La clé est générée au premier lancement et gardée dans le Keystore d'Android (jamais affichée ni envoyée).
- **File d'attente** (`outbox`) sur disque : survit à la fermeture et au redémarrage. Chaque opération a une clé d'idempotence stable ; un renvoi ne crée pas de doublon.
- **Envoi** par lots de 50. Résultat explicite par opération : `accepted`, `rejected`, `to_correct`, `conflict`, `pending_validation`. Une coupure laisse tout en file.
- **Réception** des changements depuis un curseur, appliqués en une transaction ; le curseur n'avance qu'après application.
- **Une déclaration reste « locale »** tant que le serveur ne l'a pas confirmée. Elle ne vaut ni réception ni paiement. Le montant affiché hors ligne est une estimation (arithmétique décimale exacte) ; le montant définitif est calculé par le serveur.
- **Permissions** : le serveur renvoie les permissions courantes à chaque synchronisation ; l'appareil retire les données qui ne sont plus autorisées.
- **Schéma versionné** : `AppDatabase._migrations` (une entrée par version) pour mettre à jour sans perdre la file d'attente.

## À faire ensuite

- Pesée et réception sur mobile (le serveur accepte déjà `weighing.create` via la synchronisation).
- Pièces justificatives (photos) et géolocalisation.
- Effacement à distance d'un appareil perdu (révocation de session déjà disponible côté serveur).
- Tests d'intégration sur appareil réel avec coupures réseau.
