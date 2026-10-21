/// Adresse de l'API. Se change à la compilation :
///   flutter run --dart-define=API_BASE=https://api.exemple.ci/v1
/// (10.0.2.2 = machine hôte vue depuis l'émulateur Android)
class Config {
  static const apiBase = String.fromEnvironment('API_BASE', defaultValue: 'http://10.0.2.2:3000/v1');
  /// Serveur de coopérative en HTTPS avec certificat auto-signé : empreinte SHA-256 du certificat (hexadécimal, 64 caractères), affichée par le
  /// serveur (Poste et réseau). Vide = certificat classique vérifié par Android. Exemple :
  ///   flutter build apk --dart-define=API_BASE=https://192.168.1.10:3000/v1 --dart-define=API_CERT_SHA256=ab12...
  static const apiCertSha256 = String.fromEnvironment('API_CERT_SHA256', defaultValue: '');
  /// Fonds de carte en ligne. Plan : OpenStreetMap (https://operations.osmfoundation.org/policies/tiles/ : pas de téléchargement en masse, attribution obligatoire,
  /// identification de l'application). Satellite : imagerie Esri World Imagery, dont les conditions d'usage (attribution, licence pour un usage commercial)
  /// sont à vérifier par la coopérative ; remplaçable à la compilation par un autre fournisseur :
  ///   --dart-define=SATELLITE_TILE_URL=https://exemple.ci/{z}/{x}/{y}.jpg
  static const osmTileUrl = String.fromEnvironment('OSM_TILE_URL', defaultValue: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  static const satelliteTileUrl = String.fromEnvironment('SATELLITE_TILE_URL',
      defaultValue: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}');
  static const tileUserAgent = 'AgriTrace/0.1 (application de traçabilité des coopératives agricoles)';
  static const syncIntervalMinutes = 2;
  static const batchSize = 50;
}

/// Couleurs de la charte graphique (brand/tokens.json).
class Brand {
  static const forest = 0xFF0B5E3B;
  static const nature = 0xFF16A34A;
  static const lime = 0xFF84CC16;
  static const sun = 0xFFF59E0B;
  static const carbon = 0xFF1F2937;
}
