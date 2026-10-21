import 'dart:convert';
import 'dart:typed_data';

import '../main.dart';

/// Logo de la coopérative : téléchargé quand le réseau est là, conservé sur le téléphone pour l'affichage hors connexion.
class OrgLogo {
  static const _kv = 'org_logo';

  static Future<Uint8List?> cached() async {
    try {
      final v = await services.db.getKv(_kv);
      return v == null || v.isEmpty ? null : base64Decode(v);
    } catch (_) {
      return null;
    }
  }

  /// Met le cache à jour ; retourne true si le logo affiché a changé. Sans réseau, le logo en cache est conservé.
  static Future<bool> refresh() async {
    try {
      final b = await services.api.getBytes('/organization/logo');
      final next = b == null ? '' : base64Encode(b);
      final old = await services.db.getKv(_kv) ?? '';
      if (next == old) return false;
      await services.db.setKv(_kv, next);
      return true;
    } catch (_) {
      return false;
    }
  }
}
