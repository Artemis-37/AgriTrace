import 'package:flutter/material.dart';

import '../data/map_pack.dart';
import '../main.dart';

/// Fond de carte hors ligne : état du paquet sur le téléphone et téléchargement depuis le serveur de la coopérative.
class MapPackScreen extends StatefulWidget {
  const MapPackScreen({super.key});
  @override
  State<MapPackScreen> createState() => _MapPackScreenState();
}

class _MapPackScreenState extends State<MapPackScreen> {
  MapPackInfo? _remote;
  bool _checked = false, _noNetwork = false;

  MapPackStore get _store => services.mapPack;

  @override
  void initState() {
    super.initState();
    _check();
  }

  Future<void> _check() async {
    setState(() => _checked = false);
    final r = await _store.remote();
    if (!mounted) return;
    setState(() { _remote = r; _checked = true; _noNetwork = r == null; });
  }

  Future<void> _download() async {
    final done = await _store.sync(known: _remote);
    if (!mounted) return;
    setState(() {});
    if (done) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Fond de carte installé : il fonctionne sans connexion.')));
  }

  String _mb(int b) => '${(b / 1048576).toStringAsFixed(b < 10485760 ? 1 : 0)} Mo';

  @override
  Widget build(BuildContext context) {
    final local = _store.local;
    final outdated = _store.needsDownload(_remote);
    return Scaffold(
      appBar: AppBar(title: const Text('Fond de carte hors ligne')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        ListTile(
          contentPadding: EdgeInsets.zero, leading: const Icon(Icons.phone_android),
          title: Text(local == null ? 'Aucun fond de carte sur ce téléphone' : local.name),
          subtitle: Text(local == null ? 'Le plan du tracé s\'affiche sans fond.' : '${_mb(local.sizeBytes)} · utilisable sans connexion'),
        ),
        const Divider(),
        if (!_checked) const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()))
        else if (_noNetwork) ...[
          const Text('Le serveur de la coopérative est injoignable ou n\'a pas de fond de carte. Connectez-vous au Wi-Fi de la coopérative et réessayez.'),
          const SizedBox(height: 8),
          OutlinedButton.icon(onPressed: _check, icon: const Icon(Icons.refresh), label: const Text('Vérifier à nouveau')),
        ] else ...[
          ListTile(
            contentPadding: EdgeInsets.zero, leading: const Icon(Icons.cloud_outlined),
            title: Text(_remote!.name), subtitle: Text('Sur le serveur · ${_mb(_remote!.sizeBytes)}'),
          ),
          ValueListenableBuilder<double?>(
            valueListenable: _store.progress,
            builder: (_, p, __) => p == null
                ? FilledButton.icon(
                    onPressed: outdated && !_store.busy ? _download : null,
                    icon: const Icon(Icons.download),
                    label: Text(local == null ? 'Télécharger le fond de carte' : outdated ? 'Mettre à jour le fond de carte' : 'À jour'),
                  )
                : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    LinearProgressIndicator(value: p == 0 ? null : p),
                    const SizedBox(height: 6),
                    Text('Téléchargement… ${(p * 100).toStringAsFixed(0)} %'),
                  ]),
          ),
          if (_store.lastError != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_store.lastError!, style: TextStyle(color: Colors.red.shade700))),
          const SizedBox(height: 12),
          const Text('Le fichier est de taille importante : préférez le Wi-Fi de la coopérative. Si la connexion se coupe, le téléchargement reprend où il s\'est arrêté. Il est vérifié avant utilisation.'),
        ],
      ]),
    );
  }
}
