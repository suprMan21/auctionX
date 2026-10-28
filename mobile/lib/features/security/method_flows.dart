import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app_providers.dart';
import '../mfa/data/mfa_models.dart';
import '../mfa/mfa_copy.dart';
import '../mfa/presentation/step_up_sheet.dart';
import 'authenticator_setup_screen.dart';
import 'backup_codes_screen.dart';

/// "26 Oct 2026, 3:15 PM" in the phone's language and time zone.
String formatWhen(BuildContext context, DateTime when) {
  final l = MaterialLocalizations.of(context);
  final local = when.toLocal();
  return '${l.formatMediumDate(local)}, ${l.formatTimeOfDay(TimeOfDay.fromDateTime(local))}';
}

String defaultPasskeyName() {
  if (kIsWeb) return 'Passkey';
  if (Platform.isIOS) return 'iPhone';
  if (Platform.isAndroid) return 'Android phone';
  return 'Passkey';
}

/// Same rule as the backend's nickname check.
String? nicknameProblem(String value) {
  final v = value.trim();
  if (v.isEmpty) return 'Give it a name.';
  if (v.length > 40) return 'Use 40 characters or fewer.';
  if (RegExp(r'[<>\u0000-\u001f]').hasMatch(v)) return 'Use letters, numbers and spaces.';
  return null;
}

/// Adding, removing and renaming sign-in methods. Every change goes through
/// the server's rules: a confirm (step-up) for anything but the first method,
/// always for a removal, and the last method can't go.
class MethodFlows {
  MethodFlows(this.context, this.ref, {this.now});

  final BuildContext context;
  final WidgetRef ref;
  final DateTime Function()? now;

  void _say(String message) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<String?> _confirm(MfaStatus status, StepUpAction action, String target, String purpose) =>
      confirmItsYou(context, action: action, targetId: target, status: status, purpose: purpose, now: now);

  /// After any add / remove / new codes.
  Future<void> _after({
    required bool otherSessionsEnded,
    List<String>? backupCodes,
    DateTime? waitsUntil,
    required String done,
  }) async {
    if (!context.mounted) return;
    if (backupCodes != null) {
      await Navigator.of(context).push(MaterialPageRoute<void>(
        fullscreenDialog: true,
        builder: (_) => BackupCodesScreen(codes: backupCodes, firstMethod: true),
      ));
    }
    if (!context.mounted) return;
    if (waitsUntil != null && waitsUntil.isAfter((now ?? DateTime.now)())) {
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Added'),
          content: Text(
            'You can sign in with it now. Because you confirmed with a code, it can approve changes '
            'from ${formatWhen(context, waitsUntil)}. We’ve emailed you about it.',
          ),
          actions: [TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('OK'))],
        ),
      );
    }
    _say(otherSessionsEnded ? '$done You were signed out on your other devices.' : done);
  }

  /// Name, confirm (unless first), OS sheet, save. True when added.
  Future<bool> addPasskey(MfaStatus status) async {
    final name = await askName(title: 'Name this passkey', initial: defaultPasskeyName(), action: 'Continue');
    if (name == null || !context.mounted) return false;
    String? grant;
    if (status.hasFactor) {
      grant = await _confirm(status, StepUpAction.factorAdd, 'passkey', 'Add a passkey to your account.');
      if (grant == null) return false;
    }
    try {
      final api = ref.read(mfaApiProvider);
      final options = await api.passkeyRegisterOptions(stepUpToken: grant);
      final response = await ref.read(passkeyClientProvider).create(options.options);
      final added = await api.passkeyRegisterVerify(
        challengeId: options.challengeId,
        nickname: name,
        response: response,
      );
      await _after(
        otherSessionsEnded: added.otherSessionsEnded,
        backupCodes: added.backupCodes,
        waitsUntil: added.passkey.usableFrom,
        done: 'Passkey added.',
      );
      return true;
    } catch (e) {
      if (!isCancelled(e)) _say(passkeyCreateErrorCopy(e));
      return false;
    }
  }

  /// Confirm (unless first), then the set-up screen. True when turned on.
  Future<bool> addAuthenticatorApp(MfaStatus status) async {
    String? grant;
    if (status.hasFactor) {
      grant = await _confirm(status, StepUpAction.factorAdd, 'totp', 'Add an authenticator app to your account.');
      if (grant == null || !context.mounted) return false;
    }
    final result = await Navigator.of(context).push(MaterialPageRoute<TotpConfirmed>(
      builder: (_) => AuthenticatorSetupScreen(stepUpToken: grant),
    ));
    if (result == null) return false;
    await _after(
      otherSessionsEnded: result.otherSessionsEnded,
      backupCodes: result.backupCodes,
      waitsUntil: result.usableFrom,
      done: 'Authenticator app turned on.',
    );
    return true;
  }

  Future<bool> newBackupCodes(MfaStatus status) async {
    final go = await _yesNo(
      title: 'Make new backup codes?',
      body: 'Your old backup codes will stop working.',
      yes: 'Make new codes',
    );
    if (!go || !context.mounted) return false;
    final grant = await _confirm(status, StepUpAction.recoveryRegen, 'recovery_codes', 'Make new backup codes.');
    if (grant == null) return false;
    try {
      final result = await ref.read(mfaApiProvider).regenerateBackupCodes(grant);
      if (!context.mounted) return true;
      await Navigator.of(context).push(MaterialPageRoute<void>(
        fullscreenDialog: true,
        builder: (_) => BackupCodesScreen(codes: result.codes),
      ));
      _say(result.otherSessionsEnded ? 'New backup codes made. You were signed out on your other devices.' : 'New backup codes made.');
      return true;
    } catch (e) {
      _say(mfaErrorCopy(e));
      return false;
    }
  }

  Future<bool> removePasskey(MfaStatus status, PasskeySummary passkey) async {
    if (!await _mayRemove(status)) return false;
    final go = await _yesNo(
      title: 'Remove “${passkey.nickname}”?',
      body: 'You won’t be able to sign in with this passkey any more. '
          'Removing it signs you out on your other devices.',
      yes: 'Remove',
      destructive: true,
    );
    if (!go || !context.mounted) return false;
    final grant = await _confirm(
      status,
      StepUpAction.factorRemove,
      'passkey:${passkey.id}',
      'Remove the passkey “${passkey.nickname}”.',
    );
    if (grant == null) return false;
    try {
      final result = await ref.read(mfaApiProvider).removePasskey(passkey.id, grant);
      _say(result.otherSessionsEnded ? 'Passkey removed. You were signed out on your other devices.' : 'Passkey removed.');
      return true;
    } catch (e) {
      _say(mfaErrorCopy(e));
      return false;
    }
  }

  Future<bool> removeAuthenticatorApp(MfaStatus status) async {
    if (!await _mayRemove(status)) return false;
    final go = await _yesNo(
      title: 'Turn off the authenticator app?',
      body: 'Its codes will stop working for this account. '
          'Turning it off signs you out on your other devices.',
      yes: 'Turn off',
      destructive: true,
    );
    if (!go || !context.mounted) return false;
    final grant = await _confirm(status, StepUpAction.factorRemove, 'totp', 'Turn off the authenticator app.');
    if (grant == null) return false;
    try {
      final result = await ref.read(mfaApiProvider).removeTotp(grant);
      _say(result.otherSessionsEnded
          ? 'Authenticator app turned off. You were signed out on your other devices.'
          : 'Authenticator app turned off.');
      return true;
    } catch (e) {
      _say(mfaErrorCopy(e));
      return false;
    }
  }

  Future<bool> renamePasskey(PasskeySummary passkey) async {
    final name = await askName(title: 'Rename passkey', initial: passkey.nickname, action: 'Save');
    if (name == null || name == passkey.nickname) return false;
    try {
      await ref.read(mfaApiProvider).renamePasskey(passkey.id, name);
      return true;
    } catch (e) {
      _say(mfaErrorCopy(e));
      return false;
    }
  }

  /// The last method can't go (the server would refuse after the confirm).
  Future<bool> _mayRemove(MfaStatus status) async {
    if (status.methodCount > 1) return true;
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Add another way first'),
        content: const Text('This is your only way to confirm it’s you. Add another passkey or an '
            'authenticator app before removing it.'),
        actions: [TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('OK'))],
      ),
    );
    return false;
  }

  Future<bool> _yesNo({required String title, required String body, required String yes, bool destructive = false}) async {
    final answer = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: destructive ? TextButton.styleFrom(foregroundColor: const Color(0xFFF87171)) : null,
            child: Text(yes),
          ),
        ],
      ),
    );
    return answer ?? false;
  }

  /// A name dialog; null when cancelled.
  Future<String?> askName({required String title, required String initial, required String action}) =>
      showDialog<String>(context: context, builder: (_) => _NameDialog(title: title, initial: initial, action: action));
}

class _NameDialog extends StatefulWidget {
  const _NameDialog({required this.title, required this.initial, required this.action});
  final String title;
  final String initial;
  final String action;

  @override
  State<_NameDialog> createState() => _NameDialogState();
}

class _NameDialogState extends State<_NameDialog> {
  late final _controller = TextEditingController(text: widget.initial);
  String? _problem;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    final problem = nicknameProblem(_controller.text);
    if (problem != null) {
      setState(() => _problem = problem);
      return;
    }
    Navigator.of(context).pop(_controller.text.trim());
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(widget.title),
        content: TextField(
          controller: _controller,
          autofocus: true,
          maxLength: 40,
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => _submit(),
          decoration: InputDecoration(
            labelText: 'Name',
            helperText: 'So you can tell your passkeys apart.',
            errorText: _problem,
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
          TextButton(onPressed: _submit, child: Text(widget.action)),
        ],
      );
}
