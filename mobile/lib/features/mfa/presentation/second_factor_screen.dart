import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app_providers.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_typography.dart';
import '../../../shared/widgets/open_link.dart';
import '../../auth/presentation/widgets/auth_text_field.dart';
import '../../auth/presentation/widgets/gradient_button.dart';
import '../data/mfa_models.dart';
import '../mfa_copy.dart';
import '../session_gate.dart';
import 'gate_screens.dart';

enum _Mode { choose, authenticatorCode, backupCode }

/// The step after the password: passkey first, then an authenticator code or
/// a backup code. Mirrors the website's /sign-in/verify.
class SecondFactorScreen extends ConsumerStatefulWidget {
  const SecondFactorScreen({super.key, this.now});

  /// Injected in tests.
  final DateTime Function()? now;

  @override
  ConsumerState<SecondFactorScreen> createState() => _SecondFactorScreenState();
}

class _SecondFactorScreenState extends ConsumerState<SecondFactorScreen> {
  final _code = TextEditingController();
  _Mode _mode = _Mode.choose;
  bool _busy = false;
  String? _error;

  DateTime _now() => (widget.now ?? DateTime.now)();

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  void _setMode(_Mode mode) => setState(() {
        _mode = mode;
        _error = null;
        _code.clear();
      });

  Future<void> _run(Future<SignInResult> Function() attempt) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await attempt();
      TextInput.finishAutofillContext();
      final left = result.backupCodesLeft;
      if (left != null && left <= 3 && mounted) await _lowCodesNotice(left);
      // The gate turns Ready and the router moves on.
      await ref.read(sessionGateProvider.notifier).refresh(quiet: true);
    } catch (e) {
      if (mounted && !isCancelled(e)) setState(() => _error = mfaErrorCopy(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _withPasskey() => _run(() async {
        final api = ref.read(mfaApiProvider);
        final options = await api.signInOptions();
        final response = await ref.read(passkeyClientProvider).getAssertion(options.options);
        return api.signInWithPasskey(options.challengeId, response);
      });

  Future<void> _withCode() async {
    final code = _code.text.trim();
    if (_mode == _Mode.authenticatorCode && !RegExp(r'^\d{6}$').hasMatch(code)) {
      setState(() => _error = 'Enter the 6-digit code from your authenticator app.');
      return;
    }
    if (_mode == _Mode.backupCode && code.isEmpty) {
      setState(() => _error = 'Enter one of your backup codes.');
      return;
    }
    final api = ref.read(mfaApiProvider);
    await _run(() => _mode == _Mode.authenticatorCode
        ? api.signInWithAuthenticatorCode(code)
        : api.signInWithBackupCode(code));
  }

  Future<void> _lowCodesNotice(int left) => showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Backup codes running low'),
          content: Text(
            left == 0
                ? 'That was your last backup code. Make new ones on our website under Security.'
                : 'You have $left backup ${left == 1 ? 'code' : 'codes'} left. '
                    'Make new ones on our website under Security.',
          ),
          actions: [TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('OK'))],
        ),
      );

  /// iOS fills from Passwords with oneTimeCode; Android's hint for an
  /// authenticator app code is `2faAppOTPCode`.
  List<String> get _codeHints => [
        AutofillHints.oneTimeCode,
        if (!kIsWeb && Platform.isAndroid) '2faAppOTPCode',
      ];

  @override
  Widget build(BuildContext context) {
    final gate = ref.watch(sessionGateProvider);
    if (gate is! GateSecondFactor) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final status = gate.status;
    final lockedUntil = status.codeEntryLockedUntil;
    final codesLocked = status.codesLockedAt(_now());
    final links = ref.watch(webLinksProvider);

    return GateScaffold(
      title: 'Confirm it’s you',
      children: [
        const GateText('Your password was right. One more step keeps your seals safe if someone else learns it.'),
        if (_mode == _Mode.choose) ...[
          if (status.hasPasskey) ...[
            GradientButton(
              text: _busy ? 'Waiting for your passkey…' : 'Use passkey',
              isLoading: _busy,
              onPressed: _busy ? null : _withPasskey,
            ),
            const SizedBox(height: 12),
          ],
          if (status.canUseAuthenticatorApp) ...[
            OutlinedButton(
              onPressed: _busy || codesLocked ? null : () => _setMode(_Mode.authenticatorCode),
              child: const Text('Use authenticator app code'),
            ),
            const SizedBox(height: 12),
          ],
          if (status.canUseBackupCode)
            TextButton(
              onPressed: _busy || codesLocked ? null : () => _setMode(_Mode.backupCode),
              child: const Text('Use a backup code'),
            ),
          if (codesLocked && lockedUntil != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                'Too many wrong codes. Code entry opens again at '
                '${TimeOfDay.fromDateTime(lockedUntil.toLocal()).format(context)}.'
                '${status.hasPasskey ? ' Your passkey still works.' : ''}',
                style: AppTypography.bodyMedium.copyWith(color: AppColors.warning),
                textAlign: TextAlign.center,
              ),
            ),
        ] else
          AutofillGroup(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                AuthTextField(
                  controller: _code,
                  label: _mode == _Mode.authenticatorCode ? 'Authenticator app code' : 'Backup code',
                  keyboardType:
                      _mode == _Mode.authenticatorCode ? TextInputType.number : TextInputType.visiblePassword,
                  // A backup code gets no hint: nothing should offer to fill or save it.
                  autofillHints: _mode == _Mode.authenticatorCode ? _codeHints : null,
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => _withCode(),
                  enabled: !_busy,
                ),
                const SizedBox(height: 16),
                GradientButton(text: 'Continue', isLoading: _busy, onPressed: _busy ? null : _withCode),
                TextButton(onPressed: _busy ? null : () => _setMode(_Mode.choose), child: const Text('Back')),
              ],
            ),
          ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Semantics(
              liveRegion: true,
              child: Text(
                _error!,
                style: AppTypography.bodyMedium.copyWith(color: AppColors.errorText),
                textAlign: TextAlign.center,
              ),
            ),
          ),
        const SizedBox(height: 24),
        const Divider(color: AppColors.glassBorder),
        const SizedBox(height: 16),
        Text(
          'Can’t use any of these? We can’t switch off two-step sign-in for you, but you can recover '
          'your account by email on our website. It takes 3 days, so someone with your password can’t do it quietly.',
          style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary),
        ),
        if (!status.isStaff)
          TextButton(
            onPressed: () => openExternal(context, links.recover),
            child: const Text('Recover by email'),
          ),
        const SignOutButton(),
      ],
    );
  }
}
