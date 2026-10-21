# Compiler l'installateur Windows avec Inno Setup

`agritrace.iss` produit `AgriTrace-Setup-<version>.exe` à partir du dossier `win-unpacked` d'electron-builder. Il reprend le comportement de l'installateur NSIS :

- contrat de licence (`build/license_fr.txt`) à accepter, interface en français ;
- installation pour tous les utilisateurs (droits administrateur), icône bureau facultative, menu Démarrer, désinstallation ;
- règles de pare-feu (TCP 3000 et UDP 8099, réseaux privé/domaine uniquement), retirées à la désinstallation ;
- les données (base, sauvegardes, paramètres) sont dans le profil utilisateur : mise à jour et désinstallation ne les effacent pas.

## Étapes (sur Windows, Node 22 et Inno Setup 6 installés)

1. À la racine du dépôt : `cd backend && npm ci && npm run build`, puis `cd ../web && npm ci && npm run build`.
2. `cd ../desktop && npm ci && node scripts/prepare-payload.js && npm run dist:dir` → crée `dist\win-unpacked`.
   *(Sans Windows sous la main : télécharger l'artefact **AgriTrace-win-unpacked** du workflow GitHub « Application Windows » et le placer dans `desktop\dist\win-unpacked`.)*
3. Ouvrir `installer\agritrace.iss` dans Inno Setup, régler la version (`#define AppVersion`) puis **Compiler (F9)**. En ligne de commande : `ISCC.exe installer\agritrace.iss /DAppVersion=0.2.0`.
4. Résultat : `desktop\dist\AgriTrace-Setup-<version>.exe`.

## Points d'attention

- **Ne changez jamais `AppId`** : c'est lui qui permet d'installer une nouvelle version par-dessus l'ancienne.
- La mise à jour automatique de l'application lance l'installateur avec `/S /VERYSILENT /SUPPRESSMSGBOXES /NORESTART` : elle fonctionne donc avec l'installateur NSIS comme avec celui d'Inno Setup. Le nom du fichier publié doit rester `AgriTrace-Setup-<version>.exe`.
- Cet installateur n'a pas pu être compilé ni essayé dans l'environnement de développement (Linux) : faites un premier essai sur un poste de test (installation, pare-feu, mise à jour par-dessus, désinstallation).
- Si vous signez l'exécutable (certificat de signature de code), ajoutez `SignTool=` dans `[Setup]` ; sans signature, Windows SmartScreen affichera un avertissement.
