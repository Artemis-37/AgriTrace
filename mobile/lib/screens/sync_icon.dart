import 'package:flutter/material.dart';

import '../main.dart';
import '../sync/sync_engine.dart';

/// Icône de synchronisation : tourne pendant une synchronisation, devient « sans réseau » hors connexion ; un appui relance la synchronisation.
class SyncIcon extends StatefulWidget {
  final Color color;
  final double size;
  final bool tappable;
  const SyncIcon({super.key, this.color = Colors.white, this.size = 24, this.tappable = true});
  @override
  State<SyncIcon> createState() => _SyncIconState();
}

class _SyncIconState extends State<SyncIcon> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1100));

  void _update() {
    final busy = services.sync.status.value.phase == SyncPhase.syncing;
    if (busy && !_c.isAnimating) { _c.repeat(); }
    else if (!busy && _c.isAnimating) { _c.stop(); _c.value = 0; }
  }

  @override
  void initState() {
    super.initState();
    services.sync.status.addListener(_update);
    _update();
  }

  @override
  void dispose() {
    services.sync.status.removeListener(_update);
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<SyncStatus>(
      valueListenable: services.sync.status,
      builder: (_, s, __) {
        final icon = s.phase == SyncPhase.offline ? Icons.sync_disabled : (s.phase == SyncPhase.error || s.phase == SyncPhase.blocked) ? Icons.sync_problem : Icons.sync;
        final w = RotationTransition(turns: Tween(begin: 1.0, end: 0.0).animate(_c), child: Icon(icon, color: widget.color, size: widget.size));
        if (!widget.tappable) return w;
        return IconButton(tooltip: 'Synchroniser', onPressed: s.phase == SyncPhase.syncing ? null : () => services.sync.run(), icon: w);
      },
    );
  }
}
