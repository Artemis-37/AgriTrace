/// Quantité affichée sans décimales inutiles : "965.000" -> "965", "5.000" -> "5".
/// Les poids (kg) et nombres de sacs s'affichent toujours en entiers (arrondis).
String fmtQty(Object? v) {
  final n = num.tryParse('${v ?? ''}'.replaceAll(',', '.'));
  if (n == null) return '${v ?? ''}';
  return n.round().toString();
}
