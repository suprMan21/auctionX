import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app_providers.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_typography.dart';
import '../../auth/presentation/widgets/auth_text_field.dart';
import '../../auth/presentation/widgets/gradient_button.dart';
import '../data/mfa_models.dart';
import '../mfa_copy.dart';

enum StepUpMethod { passkey, authenticatorCode, backupCode }

/// Which ways of confirming are offered (same rules as the website's
/// `lib/stepUp.ts`; the server enforces them). Changing sign-in methods takes
/// any of the three, so someone who lost their phone can still fix their
/// account. S-MOB2 adds sealing here.
List<StepUpMethod> allowedStepUpMethods(StepUpAction action) => switch (action) {
      StepUpAction.factorAdd || StepUpAction.factorRemove || StepUpAction.recoveryRegen => StepUpMethod.values,
    };

/// Asks the person to confirm it's them for one [action] on one [targetId].
/// Returns the single-use grant token, or null if they closed the sheet.
Future<String?> confirmItsYou(
  BuildContext context, {
  required StepUpAction action,
  required String targetId,
  required MfaStatus status,
  required String purpose,
  DateTime Function()? now,
}) =>
    showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (_) => StepUpSheet(action: action, targetId: targetId, status: status, purpose: purpose, now: now),
    );

enum _Mode { choose, authenticatorCode, backupCode }

class StepUpSheet extends ConsumerStatefulWidget {
  const StepUpSheet({
    super.key,
    required this.action,
    required this.targetId,
    required this.status,
    required this.purpose,
    this.now,
  });

  final StepUpAction action;
  final String targetId;
  final MfaStatus status;

  /// What is being confirmed, e.g. "Remove the passkey “iPhone”."
  final String purpose;
  final DateTime Function()? now;

  @override
  ConsumerState<StepUpSheet> createState() => _StepUpSheetState();
}

class _StepUpSheetState extends ConsumerState<StepUpSheet> {
  final _code = TextEditingController();
  _Mode _mode = _Mode.choose;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  List<StepUpMethod> get _allowed => allowedStepUpMethods(widget.action);

  void _setMode(_Mode mode) => setState(() {
        _mode = mode;
        _error = null;
        _code.clear();
      });

  Future<void> _run(Future<StepUpGrant> Function() attempt) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final grant = await attempt();
      if (mounted) Navigator.of(context).pop(grant.token);
    } catch (e) {
      if (mounted && !isCancelled(e)) setState(() => _error = mfaErrorCopy(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _withPasskey() => _run(() async {
        final api = ref.read(mfaApiProvider);
        final options = await api.stepUpOptions(widget.action, widget.targetId);
        final response = await ref.read(passkeyClientProvider).getAssertion(options.options);
        return api.stepUpWithPasskey(options.challengeId, response);
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
        ? api.stepUpWithAuthenticatorCode(widget.action, widget.targetId, code)
        : api.stepUpWithBackupCode(widget.action, widget.targetId, code));
  }

  List<String> get _codeHints => [
        AutofillHints.oneTimeCode,
        if (!kIsWeb && Platform.isAndroid) '2faAppOTPCode',
      ];

  @override
  Widget build(BuildContext context) {
    final s = widget.status;
    final now = (widget.now ?? DateTime.now)();
    final codesLocked = s.codesLockedAt(now);
    final showPasskey = s.hasPasskey && _allowed.contains(StepUpMethod.passkey);
    final showTotp = s.canUseAuthenticatorApp && _allowed.contains(StepUpMethod.authenticatorCode);
    final showBackup = s.canUseBackupCode && _allowed.contains(StepUpMethod.backupCode);
    final backupRefused = s.canUseBackupCode && !_allowed.contains(StepUpMethod.backupCode);

    return Padding(
      padding: EdgeInsets.only(
        left: 24,
        right: 24,
        top: 24,
        bottom: 24 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              header: true,
              child: Text('Confirm it’s you', style: AppTypography.headlineSmall, textAlign: TextAlign.center),
            ),
            const SizedBox(height: 8),
            Text(
              widget.purpose,
              style: AppTypography.bodyLarge.copyWith(color: AppColors.textSecondary),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 20),
            if (_mode == _Mode.choose) ...[
              if (showPasskey) ...[
                GradientButton(
                  text: _busy ? 'Waiting for your passkey…' : 'Use passkey',
                  isLoading: _busy,
                  onPressed: _busy ? null : _withPasskey,
                ),
                const SizedBox(height: 12),
              ],
              if (showTotp) ...[
                OutlinedButton(
                  onPressed: _busy || codesLocked ? null : () => _setMode(_Mode.authenticatorCode),
                  child: const Text('Use authenticator app code'),
                ),
                const SizedBox(height: 12),
              ],
              if (showBackup)
                TextButton(
                  onPressed: _busy || codesLocked ? null : () => _setMode(_Mode.backupCode),
                  child: const Text('Use a backup code'),
                ),
              if (backupRefused)
                Text(
                  'Backup codes can’t confirm this.',
                  style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary),
                  textAlign: TextAlign.center,
                ),
              if (codesLocked && s.codeEntryLockedUntil != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    'Too many wrong codes. Code entry opens again at '
                    '${TimeOfDay.fromDateTime(s.codeEntryLockedUntil!.toLocal()).format(context)}.',
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
                      autofillHints: _mode == _Mode.authenticatorCode ? _codeHints : null,
                      textInputAction: TextInputAction.done,
                      onSubmitted: (_) => _withCode(),
                      enabled: !_busy,
                    ),
                    const SizedBox(height: 16),
                    GradientButton(text: 'Confirm', isLoading: _busy, onPressed: _busy ? null : _withCode),
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
            const SizedBox(height: 8),
            TextButton(
              onPressed: _busy ? null : () => Navigator.of(context).pop(),
              child: const Text('Cancel'),
            ),
          ],
        ),
      ),
    );
  }
}
