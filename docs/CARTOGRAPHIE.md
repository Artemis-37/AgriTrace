# Cartographie avancée (CDC §10)

## Contrôles géométriques
- Polygones WGS84 uniquement (pas de reprojection : un fichier en coordonnées projetées est signalé invalide). Trous et polygones auto-sécants (« papillon ») refusés.
- Superficie mesurée (calculée) distincte de la superficie déclarée ; les deux sont conservées.
- Empreinte `geometry_hash` (SHA-256 de la géométrie normalisée : 7 décimales, sens horaire, départ au plus petit sommet).

## Chevauchements et doublons
- Pas de PostGIS dans l'environnement : filtre par `bbox` (colonne `box`, index GiST), puis intersection exacte en Node (`@turf`).
- Seuils par coopérative (`/geo/settings`) : surface minimale (25 m²), pourcentage minimal (1 %), IoU doublon proche (0,95), politique `block` ou `warn`.
- Types : `overlap_partial`, `overlap_inclusion` (≥ 99 % de la plus petite), `duplicate_identical`, `duplicate_near`. Une limite commune sans surface n'est pas un chevauchement.
- Une anomalie bloquante empêche le contrôle et la vérification de la parcelle (422). Une exception exige la permission `geo:override` et un motif ; elle n'est pas rouverte par le contrôle périodique.
- Remplacement contrôlé (`/geo/merges`) : prévisualisation puis confirmation ; refusé si les producteurs diffèrent. L'ancienne parcelle est archivée (jamais supprimée) et son code n'est jamais réattribué.

## Import / export
- Formats : GeoJSON, KML, KMZ, Shapefile (zip), GeoPackage — vérifiés dans les deux sens avec GDAL 3.12.
- Import : simulation → confirmation, modes `create_only`, `create_update`, `quarantine`, option `all_or_nothing`, traitement en arrière-plan avec progression, rapport chiffré (CDC §10.7), fichier de quarantaine. Option `ignore_parcel_code` pour réimporter un export d'une autre coopérative.
- Export : filtres (producteur, zone `bbox`…), champs additionnels listés ; nom du producteur seulement avec `geo:export_names` ; champs sensibles (téléphone) jamais exportables. Imports et exports sont tracés dans l'audit.

## Limites connues
- `node:sqlite` (GeoPackage) est encore marqué expérimental par Node 22.
- Pas d'écran web ni mobile dédié à la cartographie avancée pour l'instant (API seulement).
- `npm audit` signale des avis sur des dépendances transitives de NestJS, à suivre.


## Carte du portail
`GET /geo/map` (permission `parcels:read`) renvoie une collection GeoJSON légère (code, producteur, filière, superficies, niveau de vérification, indicateur d'anomalie ouverte), filtrable par `bbox`, limitée à 5 000 parcelles (`truncated` l'indique). Aucune donnée personnelle, et pas d'entrée d'audit d'export : l'export complet reste sur `GET /geo/export`.
