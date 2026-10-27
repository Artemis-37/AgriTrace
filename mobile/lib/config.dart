/// Adresse de l'API. Se change à la compilation :
///   flutter run --dart-define=API_BASE=https://api.exemple.ci/v1
/// (10.0.2.2 = machine hôte vue depuis l'émulateur Android)
class Config {
  static const apiBase = String.fromEnvironment('API_BASE', defaultValue: 'http://10.0.2.2:3000/v1');
  /// Adresse effectivement utilisée : celle choisie sur l'écran de connexion (« Serveur »), sinon celle de la compilation.
  static String apiBaseRuntime = apiBase;
  /// Adresse propre : sans « / » final et toujours terminée par « /v1 » (une adresse enregistrée sans « /v1 » donnait « Cannot POST //auth/login »).
  static String normalizeBase(String u) {
    var s = u.trim().replaceAll(RegExp(r'/+$'), '');
    if (s.isEmpty) return s;
    if (!RegExp(r'/v\d+$').hasMatch(s)) s = '$s/v1';
    return s;
  }
  /// Délai d'attente des appels : un serveur gratuit endormi (Render) met jusqu'à une minute à se réveiller.
  static const requestTimeout = Duration(seconds: 75);
  /// Lecture seule : un réseau qui ne répond pas est abandonné plus vite, l'écran montre alors sa copie locale.
  static const readTimeout = Duration(seconds: 25);
  /// Serveur de coopérative en HTTPS avec certificat auto-signé : empreinte SHA-256 du certificat (hexadécimal, 64 caractères), affichée par le
  /// serveur (Poste et réseau). Vide = certificat classique vérifié par Android. Exemple :
  ///   flutter build apk --dart-define=API_BASE=https://192.168.1.10:3000/v1 --dart-define=API_CERT_SHA256=ab12...
  static const apiCertSha256 = String.fromEnvironment('API_CERT_SHA256', defaultValue: '');
  /// Fonds de carte en ligne. Plan : OpenStreetMap (https://operations.osmfoundation.org/policies/tiles/ : pas de téléchargement en masse, attribution obligatoire,
  /// identification de l'application). Satellite : imagerie Esri World Imagery, dont les conditions d'usage (attribution, licence pour un usage commercial)
  /// sont à vérifier par la coopérative ; remplaçable à la compilation par un autre fournisseur :
  ///   --dart-define=SATELLITE_TILE_URL=https://exemple.ci/{z}/{x}/{y}.jpg
  static const appVersion = String.fromEnvironment('APP_VERSION', defaultValue: '0.1.0');
  static const osmTileUrl = String.fromEnvironment('OSM_TILE_URL', defaultValue: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  static const satelliteTileUrl = String.fromEnvironment('SATELLITE_TILE_URL',
      defaultValue: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}');
  /// Clé Google Maps Platform (API « Map Tiles »), fournie à la compilation : --dart-define=GOOGLE_MAPS_KEY=… Sans clé, le fond « Google Maps » n'est pas proposé.
  static const googleMapsKey = String.fromEnvironment('GOOGLE_MAPS_KEY');
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
