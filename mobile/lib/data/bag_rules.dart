/// Règle de fonctionnement : un sac de produit pèse entre 50 et 75 kg.
/// Elle protège contre les fautes de frappe (un zéro oublié : 2 sacs pour « 11 kg » au lieu de 110 kg).
const int minKgPerBag = 50;
const int maxKgPerBag = 75;

/// null si la saisie est plausible ; sinon le message à montrer au délégué.
/// Contrôle appliqué aux pesées en kg (la seule unité où le poids d'un sac a un sens).
String? bagCheck({required String quantity, required int? bags, String unit = 'kg'}) {
  if (unit != 'kg' || bags == null || bags <= 0) return null;
  final q = double.tryParse(quantity.trim().replaceAll(',', '.'));
  if (q == null || q <= 0) return null;
  final lo = bags * minKgPerBag, hi = bags * maxKgPerBag;
  if (q >= lo && q <= hi) return null;
  final per = q / bags;
  return '$bags sac(s) pour ${_n(q)} kg font ${_n(per)} kg par sac. Un sac pèse entre $minKgPerBag et $maxKgPerBag kg : '
      'le poids total doit être compris entre $lo et $hi kg. Vérifiez le poids et le nombre de sacs.';
}

String _n(double v) => v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(1);
