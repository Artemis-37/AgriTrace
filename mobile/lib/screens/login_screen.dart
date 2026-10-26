import '../config.dart';
import 'package:flutter/material.dart';

import '../data/api_client.dart';
import '../data/session_store.dart';
import '../sync/sync_engine.dart';
import 'change_password_screen.dart';
import '../main.dart';
import 'home_screen.dart';
import 'sync_icon.dart';

class LoginScreen extends StatefulWidget {
  final String? notice;
  const LoginScreen({super.key, this.notice});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _otp = TextEditingController();
  bool _needOtp = false; // double authentification demandée par le serveur
  bool _busy = false;
  bool _show = false; // afficher le mot de passe saisi
  bool _syncing = false;
  String? _error;
  String _who = ''; // e-mail du compte qui se connecte : propriétaire des saisies en attente

  @override
  void initState() {
    super.initState();
    _error = widget.notice;
    _loadKnown();
  }

  Future<void> _loadKnown() async {
    final k = await services.store.knownAccounts();
    if (mounted) setState(() => _known = k);
  }

  /// Compte déjà connecté sur ce téléphone : reprise de la session sans mot de passe ; hors connexion, accès aux données de l'appareil.
  Future<void> _useKnown(KnownAccount a) async {
    setState(() { _busy = true; _error = null; });
    try {
      _who = a.email;
      final used = await services.store.useAccount(a.email);
      if (used == null) { _askPassword(a); return; }
      try {
        await services.api.get('/me');
      } on NetworkException {
        if (!mounted) return;
        await services.repo.switchUser(a.email);
        if (!mounted) return;
        Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const SyncShell(child: HomeScreen())));
        return;
      } on ApiException {
        await services.store.invalidateCurrentAccount();
        await services.store.signOut();
        await _loadKnown();
        _askPassword(a);
        return;
      }
      final orgs = await services.api.myOrganizations();
      if (a.org.isNotEmpty && orgs.any((o) => o['id'] == a.org)) { await _enter(a.org, remember: false); }
      else if (orgs.length == 1) { await _enter(orgs.first['id'] as String, remember: false); }
      else { setState(() => _orgs = orgs); }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _askPassword(KnownAccount a) {
    if (!mounted) return;
    setState(() { _email.text = a.email; _password.clear(); _error = 'Session expirée pour ${a.name.isEmpty ? a.email : a.name} : saisissez votre mot de passe.'; });
  }
  List<dynamic> _orgs = [];
  List<KnownAccount> _known = [];
  bool _testing = false;
  String? _serverResult;

  /// Test de la liaison avec le serveur, sans afficher son adresse (un serveur endormi peut mettre une minute à répondre).
  Future<void> _testServer() async {
    setState(() { _testing = true; _serverResult = null; });
    final err = await services.api.probe(Config.apiBaseRuntime);
    if (!mounted) return;
    setState(() { _testing = false; _serverResult = err == null ? '✓ Connexion au serveur établie.' : 'Connexion impossible. Vérifiez Internet et réessayez (un serveur au repos peut mettre une minute à se réveiller).'; });
  }
  final _code = TextEditingController();
  bool _pairing = false;

  Future<void> _pair() async {
    setState(() { _busy = true; _error = null; });
    try {
      final name = await services.api.pairWorkstation(_code.text.trim());
      if (mounted) setState(() { _pairing = false; _code.clear(); _error = 'Téléphone associé (« $name »). Vous pouvez vous connecter.'; });
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } on NetworkException {
      setState(() => _error = 'Pas de connexion : l\'association nécessite le réseau du bureau ou Internet.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Adresse du serveur : permet de joindre le serveur de test sans recompiler l'application.
  Future<void> _chooseServer() async {
    final c = TextEditingController(text: Config.apiBaseRuntime.replaceAll(RegExp(r'/v1/?$'), ''));
    String? result;
    bool testing = false;
    await showDialog<void>(context: context, builder: (ctx) => StatefulBuilder(builder: (ctx, setD) => AlertDialog(
      title: const Text('Adresse du serveur'),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Exemple : https://agritrace-xxxx.onrender.com'),
        const SizedBox(height: 8),
        TextField(controller: c, keyboardType: TextInputType.url, autocorrect: false, decoration: const InputDecoration(border: OutlineInputBorder())),
        if (testing) const Padding(padding: EdgeInsets.only(top: 12), child: Text('Test en cours… (un serveur endormi peut mettre une minute à répondre)')),
        if (result != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(result!, style: TextStyle(color: result!.startsWith('✓') ? Colors.green.shade800 : Colors.red.shade800))),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Fermer')),
        TextButton(onPressed: testing ? null : () async {
          var u = c.text.trim();
          if (u.isEmpty) return;
          if (!u.startsWith('http')) u = 'https://$u';
          u = u.replaceAll(RegExp(r'/+$'), '').replaceAll(RegExp(r'/v1$'), '');
          setD(() { testing = true; result = null; });
          final err = await services.api.probe('$u/v1');
          setD(() { testing = false; result = err == null ? '✓ Serveur joint. Adresse enregistrée.' : err; });
          if (err == null) { await services.store.setServerUrl('$u/v1'); Config.apiBaseRuntime = '$u/v1'; if (mounted) setState(() => _error = null); }
        }, child: const Text('Tester et enregistrer')),
      ],
    )));
  }

  Future<void> _login() async {
    setState(() { _busy = true; _error = null; });
    try {
      _who = _email.text.trim().toLowerCase();
      await services.api.login(_email.text.trim().toLowerCase(), _password.text, deviceLabel: 'Android', otp: _needOtp ? _otp.text.trim() : null);
      final orgs = await services.api.myOrganizations();
      if (orgs.isEmpty) {
        await services.store.signOut();
        setState(() => _error = "Ce compte n'est rattaché à aucune coopérative.");
      } else if (orgs.length == 1) {
        await _enter(orgs.first['id'] as String);
      } else {
        setState(() => _orgs = orgs);
      }
    } on NetworkException {
      setState(() => _error = 'Impossible de joindre le serveur. Vérifiez Internet, puis utilisez « Tester la connexion au serveur ».');
    } on ApiException catch (e) {
      if (e.status == 401 && e.message.contains('Code de vérification requis')) { setState(() { _needOtp = true; _error = null; }); return; }
      setState(() { _error = e.status == 401 ? (e.message.contains('Code de vérification invalide') ? 'Code de vérification invalide ou déjà utilisé.' : 'Identifiants invalides.') : e.message; if (e.message.contains('pas associé')) _pairing = true; });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _enter(String orgId, {bool remember = true}) async {
    await services.repo.switchUser(_who.isEmpty ? _email.text : _who);
    final ok = await services.repo.switchOrganization(orgId);
    if (!ok) {
      setState(() => _error = "Des opérations d'une autre coopérative ne sont pas encore envoyées. Reconnectez-vous à celle-ci et synchronisez d'abord.");
      return;
    }
    await services.store.setOrg(orgId);
    if (!mounted) return;
    var forced = false;
    try {
      final me = (await services.api.get('/me')) as Map;
      forced = me['must_change_password'] == true;
      final u = Map<String, dynamic>.from((me['user'] ?? {}) as Map);
      await services.store.rememberAccount(email: '${u['email'] ?? _email.text}', name: '${u['full_name'] ?? ''}', org: orgId);
    } catch (_) { /* hors ligne : pas de contrôle */ }
    if (!mounted) return;
    // À la connexion : synchronisation immédiate (profil, producteurs, tâches, opérations en attente), avec l'icône de synchronisation.
    if (mounted) setState(() => _syncing = true);
    try { await services.sync.run().timeout(const Duration(seconds: 25)); } catch (_) { /* hors connexion : l'accueil réessaiera */ }
    if (!mounted) return;
    void go() => Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const SyncShell(child: HomeScreen())));
    if (forced) {
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => ChangePasswordScreen(onDone: go)));
    } else {
      go();
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_syncing) {
      return Scaffold(body: SafeArea(child: Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Image.asset('assets/agritrace-logo.png', width: 260),
        const SizedBox(height: 32),
        SyncIcon(color: Theme.of(context).colorScheme.primary, size: 56, tappable: false),
        const SizedBox(height: 16),
        const Text('Synchronisation en cours…', style: TextStyle(fontSize: 18)),
        ValueListenableBuilder<List<SyncStep>>(valueListenable: services.sync.steps, builder: (_, st, __) {
          final cur = st.where((x) => x.state == SyncStepState.doing).firstOrNull;
          return Padding(padding: const EdgeInsets.only(top: 6), child: Text(cur == null ? '' : '${cur.label}${cur.detail.isEmpty ? '' : ' · ${cur.detail}'}', style: const TextStyle(color: Colors.black54)));
        }),
        const Padding(padding: EdgeInsets.fromLTRB(32, 8, 32, 0), child: Text('Mise à jour de votre profil, de vos producteurs, tâches et opérations avec le serveur.', textAlign: TextAlign.center, style: TextStyle(color: Colors.black54))),
      ]))));
    }
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                GestureDetector(onLongPress: _busy ? null : _chooseServer, child: Image.asset('assets/agritrace-logo.png', width: 280, semanticLabel: 'AgriTrace, la traçabilité agricole, de la parcelle au marché')),
                const SizedBox(height: 32),
                if (_pairing) ...[
                  const Text('Associer ce téléphone', style: TextStyle(fontWeight: FontWeight.bold)),
                  const Text("Saisissez le code d'association remis par votre administrateur (valable 15 minutes)."),
                  const SizedBox(height: 12),
                  TextField(controller: _code, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: "Code d'association", hintText: 'ABCD-2345', border: OutlineInputBorder()), onSubmitted: (_) => _pair()),
                  const SizedBox(height: 12),
                  FilledButton(onPressed: _busy ? null : _pair, child: Text(_busy ? 'Association…' : 'Associer ce téléphone')),
                  TextButton(onPressed: () => setState(() => _pairing = false), child: const Text('Retour')),
                ] else if (_orgs.isEmpty) ...[
                  if (_known.isNotEmpty) ...[
                    const Text('Comptes sur ce téléphone', style: TextStyle(fontWeight: FontWeight.bold)),
                    for (final a in _known) Card(elevation: 0, shape: RoundedRectangleBorder(side: const BorderSide(color: Color(0xFFDDDDDD)), borderRadius: BorderRadius.circular(14)), child: ListTile(
                      leading: CircleAvatar(child: Text(a.initials)),
                      title: Text(a.name.isEmpty ? a.email : a.name), subtitle: Text(a.refresh.isEmpty ? '${a.email}\nMot de passe requis' : a.email), isThreeLine: a.refresh.isEmpty,
                      trailing: IconButton(tooltip: 'Oublier ce compte', icon: const Icon(Icons.close), onPressed: _busy ? null : () async { await services.store.forgetAccount(a.email); await _loadKnown(); }),
                      onTap: _busy ? null : () => a.refresh.isEmpty ? _askPassword(a) : _useKnown(a))),
                    const SizedBox(height: 8),
                    const Text('Ou connectez-vous avec un autre compte', style: TextStyle(color: Colors.black54)),
                    const SizedBox(height: 8),
                  ],
                  TextField(controller: _email, keyboardType: TextInputType.emailAddress, autofillHints: const [AutofillHints.username], decoration: const InputDecoration(labelText: 'E-mail', border: OutlineInputBorder())),
                  const SizedBox(height: 12),
                  TextField(controller: _password, obscureText: !_show, autofillHints: const [AutofillHints.password], decoration: InputDecoration(labelText: 'Mot de passe', border: const OutlineInputBorder(), suffixIcon: IconButton(tooltip: _show ? 'Masquer le mot de passe' : 'Afficher le mot de passe', icon: Icon(_show ? Icons.visibility_off : Icons.visibility), onPressed: () => setState(() => _show = !_show))), onSubmitted: (_) => _login()),
                  if (_needOtp) ...[
                    const SizedBox(height: 12),
                    TextField(controller: _otp, keyboardType: TextInputType.number, autofocus: true, autofillHints: const [AutofillHints.oneTimeCode], decoration: const InputDecoration(labelText: "Code de vérification (application d'authentification) ou code de secours", border: OutlineInputBorder()), onSubmitted: (_) => _login()),
                  ],
                  const SizedBox(height: 16),
                  FilledButton(onPressed: _busy ? null : _login, child: Text(_busy ? 'Connexion…' : _needOtp ? 'Valider le code' : 'Se connecter')),
                  TextButton(onPressed: () => setState(() => _pairing = true), child: const Text('Associer ce téléphone à la coopérative (code)')),
                  TextButton.icon(onPressed: _busy || _testing ? null : _testServer, icon: _testing ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.wifi_find, size: 18), label: Text(_testing ? 'Test en cours…' : 'Tester la connexion au serveur')),
                  if (_serverResult != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(_serverResult!, textAlign: TextAlign.center, style: TextStyle(fontSize: 13, color: _serverResult!.startsWith('✓') ? Colors.green.shade800 : Colors.red.shade800))),
                ] else ...[
                  const Text('Choisissez la coopérative', style: TextStyle(fontWeight: FontWeight.bold)),
                  for (final o in _orgs) ListTile(title: Text(o['name'] as String), subtitle: Text(o['code'] as String), onTap: () => _enter(o['id'] as String)),
                ],
                if (_error != null) Padding(padding: const EdgeInsets.only(top: 16), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}
