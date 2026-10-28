import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app_providers.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_typography.dart';
import '../../shared/widgets/open_link.dart';
import '../auth/presentation/widgets/gradient_button.dart';
import '../mfa/data/mfa_models.dart';
import '../mfa/mfa_copy.dart';
import 'method_flows.dart';

/// Ways to confirm it's you: passkeys, authenticator app, backup codes.
/// Backup email and account recovery stay on the website.
class SecurityScreen extends ConsumerStatefulWidget {
  const SecurityScreen({super.key, this.now});

  /// Injected in tests.
  final DateTime Function()? now;

  @override
  ConsumerState<SecurityScreen> createState() => _SecurityScreenState();
}

class _SecurityScreenState extends ConsumerState<SecurityScreen> {
  MfaStatus? _status;
  String? _loadError;
  bool _busy = false;

  DateTime _now() => (widget.now ?? DateTime.now)();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final status = await ref.read(mfaApiProvider).status();
      if (mounted) {
        setState(() {
          _status = status;
          _loadError = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _loadError = mfaErrorCopy(e));
    }
  }

  /// Runs one flow at a time, then reloads if anything changed.
  Future<void> _do(Future<bool> Function(MethodFlows flows, MfaStatus status) flow) async {
    final status = _status;
    if (status == null || _busy) return;
    setState(() => _busy = true);
    try {
      final changed = await flow(MethodFlows(context, ref, now: widget.now), status);
      if (changed) await _load();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = _status;
    return Scaffold(
      appBar: AppBar(title: const Text('Security')),
      body: SafeArea(
        child: status == null
            ? (_loadError == null
                ? const Center(child: CircularProgressIndicator())
                : _LoadProblem(message: _loadError!, onRetry: _load))
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.all(20),
                  children: [
                    Text(
                      'After your password, one of these confirms it’s you. Changing them signs you out '
                      'on your other devices.',
                      style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary),
                    ),
                    const SizedBox(height: 20),
                    _passkeys(status),
                    if (!status.breakGlass) ...[
                      const SizedBox(height: 16),
                      _authenticator(status),
                    ],
                    const SizedBox(height: 16),
                    _backupCodes(status),
                    const SizedBox(height: 24),
                    Text(
                      'Your backup email and account recovery are on our website.',
                      style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary),
                    ),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton(
                        onPressed: () => openExternal(context, ref.read(webLinksProvider).security),
                        child: const Text('Open security settings on the website'),
                      ),
                    ),
                  ],
                ),
              ),
      ),
    );
  }

  Widget _passkeys(MfaStatus s) => _Section(
        title: 'Passkeys',
        intro: s.breakGlass
            ? 'This account signs in with hardware security keys only.'
            : 'Face ID, fingerprint or a security key. The quickest and safest way to confirm it’s you.',
        children: [
          if (s.passkeys.isEmpty)
            Text('None yet.', style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary)),
          for (final p in s.passkeys) _PasskeyRow(
            passkey: p,
            now: _now(),
            busy: _busy,
            onRename: () => _do((f, _) => f.renamePasskey(p)),
            onRemove: () => _do((f, st) => f.removePasskey(st, p)),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _busy ? null : () => _do((f, st) => f.addPasskey(st)),
            icon: const Icon(Icons.add),
            label: Text(s.breakGlass ? 'Add a security key' : 'Add a passkey'),
          ),
        ],
      );

  Widget _authenticator(MfaStatus s) {
    final waits = s.authenticatorAppUsableFrom;
    return _Section(
      title: 'Authenticator app',
      intro: 'A 6-digit code from an app such as Google Authenticator or 1Password.',
      children: [
        if (s.authenticatorApp) ...[
          Text('On', style: AppTypography.titleMedium.copyWith(color: AppColors.success)),
          if (waits != null && waits.isAfter(_now()))
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                'Can approve changes from ${formatWhen(context, waits)}.',
                style: AppTypography.bodyMedium.copyWith(color: AppColors.warning),
              ),
            ),
          const SizedBox(height: 8),
          OutlinedButton(
            onPressed: _busy ? null : () => _do((f, st) => f.removeAuthenticatorApp(st)),
            child: const Text('Turn off'),
          ),
        ] else
          OutlinedButton.icon(
            onPressed: _busy ? null : () => _do((f, st) => f.addAuthenticatorApp(st)),
            icon: const Icon(Icons.add),
            label: const Text('Set up an authenticator app'),
          ),
      ],
    );
  }

  Widget _backupCodes(MfaStatus s) {
    final left = s.backupCodesLeft;
    return _Section(
      title: 'Backup codes',
      intro: 'For when you can’t use your phone. Each code works once.',
      children: [
        Text(
          '$left ${left == 1 ? 'code' : 'codes'} left',
          style: AppTypography.titleMedium.copyWith(color: left <= 3 ? AppColors.warning : AppColors.textPrimary),
        ),
        if (left <= 3 && s.hasFactor)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              'Running low. Make a new set.',
              style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary),
            ),
          ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: _busy || !s.hasFactor ? null : () => _do((f, st) => f.newBackupCodes(st)),
          child: const Text('Make new backup codes'),
        ),
      ],
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.intro, required this.children});
  final String title;
  final String intro;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Semantics(header: true, child: Text(title, style: AppTypography.titleLarge)),
              const SizedBox(height: 4),
              Text(intro, style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary)),
              const SizedBox(height: 12),
              ...children,
            ],
          ),
        ),
      );
}

enum _PasskeyAction { rename, remove }

class _PasskeyRow extends StatelessWidget {
  const _PasskeyRow({
    required this.passkey,
    required this.now,
    required this.busy,
    required this.onRename,
    required this.onRemove,
  });

  final PasskeySummary passkey;
  final DateTime now;
  final bool busy;
  final VoidCallback onRename;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final l = MaterialLocalizations.of(context);
    final p = passkey;
    final waits = p.usableFrom != null && p.usableFrom!.isAfter(now);
    final secondary = AppTypography.bodySmall.copyWith(color: AppColors.textSecondary);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 2, right: 12),
            child: Icon(Icons.key, color: AppColors.accent400),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(p.nickname, style: AppTypography.titleMedium),
                const SizedBox(height: 2),
                Text(p.synced ? 'Synced with your password manager' : 'On one device or security key', style: secondary),
                Text(
                  'Added ${l.formatMediumDate(p.createdAt.toLocal())}'
                  '${p.lastUsedAt != null ? ' · Last used ${l.formatMediumDate(p.lastUsedAt!.toLocal())}' : ''}',
                  style: secondary,
                ),
                if (waits)
                  Text(
                    'Can approve changes from ${formatWhen(context, p.usableFrom!)}',
                    style: AppTypography.bodySmall.copyWith(color: AppColors.warning),
                  ),
              ],
            ),
          ),
          PopupMenuButton<_PasskeyAction>(
            enabled: !busy,
            tooltip: 'Options for ${p.nickname}',
            onSelected: (a) => a == _PasskeyAction.rename ? onRename() : onRemove(),
            itemBuilder: (_) => const [
              PopupMenuItem(value: _PasskeyAction.rename, child: Text('Rename')),
              PopupMenuItem(value: _PasskeyAction.remove, child: Text('Remove')),
            ],
          ),
        ],
      ),
    );
  }
}

class _LoadProblem extends StatelessWidget {
  const _LoadProblem({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              liveRegion: true,
              child: Text(message, style: AppTypography.bodyLarge, textAlign: TextAlign.center),
            ),
            const SizedBox(height: 16),
            GradientButton(text: 'Try again', onPressed: onRetry),
          ],
        ),
      );
}
