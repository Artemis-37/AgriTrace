/// Quantité affichée sans décimales inutiles : "965.000" -> "965", "5.000" -> "5".
/// Les poids (kg) et nombres de sacs sont des entiers ; une vraie fraction
/// (ex. 0.5 tonne) reste visible.
String fmtQty(Object? v) {
  final n = num.tryParse('${v ?? ''}'.replaceAll(',', '.'));
  if (n == null) return '${v ?? ''}';
  return n == n.truncate() ? n.truncate().toString() : n.toString();
}
