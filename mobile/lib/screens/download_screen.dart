import 'package:flutter/material.dart';

import 'map_pack_screen.dart';
import 'sync_dialog.dart';

/// « Télécharger les données » : ce que le téléphone peut récupérer pour travailler hors connexion.
class DownloadScreen extends StatelessWidget {
  const DownloadScreen({super.key});

  @override
  Widget build(BuildContext context) {
    Widget row(IconData icon, String label, VoidCallback onTap) => Container(
          margin: const EdgeInsets.only(bottom: 10),
          child: Material(color: Colors.white, child: ListTile(title: Text(label), trailing: Icon(icon, size: 30, color: Colors.black87), onTap: onTap)),
        );
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF2),
      appBar: AppBar(title: const Text('Télécharger les données')),
      body: ListView(padding: const EdgeInsets.all(12), children: [
        row(Icons.sync, 'Télécharger les données des producteurs', () async {
          await syncWithDialog(context);
        }),
        row(Icons.layers_outlined, 'Télécharger le fond de carte', () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const MapPackScreen()))),
      ]),
    );
  }
}
