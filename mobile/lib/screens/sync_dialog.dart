import 'dart:async';

import 'package:flutter/material.dart';

import '../main.dart';
import '../sync/sync_engine.dart';

/// Lance une synchronisation à la demande de l'utilisateur et en affiche la progression : envoi de ce qui est à soumettre,
/// puis téléchargement des données du serveur (le téléchargement n'a lieu que s'il ne reste rien à envoyer).
Future<void> syncWithDialog(BuildContext context) async {
  final done = services.sync.run();
  await showDialog<void>(context: context, barrierDismissible: false, builder: (_) => _SyncDialog(finished: done));
}

class _SyncDialog extends StatefulWidget {
  const _SyncDialog({required this.finished});
  final Future<void> finished;
  @override
  State<_SyncDialog> createState() => _SyncDialogState();
}

class _SyncDialogState extends State<_SyncDialog> {
  bool _over = false;

  @override
  void initState() {
    super.initState();
    // La synchronisation d'arrière-plan en cours (si l'appui tombe pendant l'une d'elles) est suivie de la même façon.
    widget.finished.whenComplete(() async {
      if (!mounted) return;
      setState(() => _over = true);
      if (services.sync.status.value.phase == SyncPhase.idle) {
        await Future<void>.delayed(const Duration(milliseconds: 1400));
        if (mounted && Navigator.of(context).canPop()) Navigator.of(context).pop();
      }
    });
  }

  Widget _icon(SyncStepState s) {
    switch (s) {
      case SyncStepState.doing: return const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.4));
      case SyncStepState.done: return const Icon(Icons.check_circle, color: Color(0xFF0B5E3B), size: 22);
      case SyncStepState.failed: return const Icon(Icons.error, color: Colors.red, size: 22);
      case SyncStepState.skipped: return const Icon(Icons.pause_circle_outline, color: Color(0xFFB26A00), size: 22);
      case SyncStepState.waiting: return const Icon(Icons.radio_button_unchecked, color: Colors.black38, size: 22);
    }
  }

  @override
  Widget build(BuildContext context) {
    final st = services.sync.status.value;
    return AlertDialog(
      title: const Text('Synchronisation'),
      content: ValueListenableBuilder<List<SyncStep>>(
        valueListenable: services.sync.steps,
        builder: (_, steps, __) {
          final doing = steps.where((x) => x.state == SyncStepState.doing).length;
          final finished = steps.where((x) => x.state == SyncStepState.done || x.state == SyncStepState.skipped).length;
          return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            LinearProgressIndicator(value: _over ? (st.phase == SyncPhase.idle ? 1 : finished / steps.length) : (finished + (doing > 0 ? .5 : 0)) / steps.length),
            const SizedBox(height: 14),
            for (final s in steps) Padding(padding: const EdgeInsets.symmetric(vertical: 5), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              _icon(s.state), const SizedBox(width: 12),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(s.label, style: TextStyle(fontWeight: s.state == SyncStepState.doing ? FontWeight.w600 : FontWeight.normal)),
                if (s.detail.isNotEmpty) Text(s.detail, style: const TextStyle(fontSize: 12, color: Colors.black54)),
              ])),
            ])),
            const SizedBox(height: 10),
            Text(
              _over
                  ? (st.phase == SyncPhase.idle ? 'Synchronisation terminée.' : (st.message ?? 'Synchronisation interrompue.'))
                  : "Vos opérations partent d'abord vers le serveur ; les données du serveur ne sont reçues que lorsqu'il ne reste rien à envoyer.",
              style: TextStyle(fontSize: 12.5, color: _over && st.phase != SyncPhase.idle ? Colors.red.shade800 : Colors.black54)),
          ]);
        },
      ),
      actions: [if (_over) TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Fermer'))],
    );
  }
}
