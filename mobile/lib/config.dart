/// Adresse de l'API. Se change à la compilation :
///   flutter run --dart-define=API_BASE=https://api.exemple.ci/v1
/// (10.0.2.2 = machine hôte vue depuis l'émulateur Android)
class Config {
  static const apiBase = String.fromEnvironment('API_BASE', defaultValue: 'http://10.0.2.2:3000/v1');
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
