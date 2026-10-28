import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app_providers.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_typography.dart';
import '../../../shared/widgets/open_link.dart';
import '../../auth/presentation/widgets/gradient_button.dart';
import '../../security/method_flows.dart';
import '../data/mfa_models.dart';
import '../session_gate.dart';

/// Centered column used by every gate screen: heading, text, actions.
class GateScaffold extends StatelessWidget {
  const GateScaffold({super.key, required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Semantics(
                    header: true,
                    child: Text(title, style: AppTypography.headlineMedium, textAlign: TextAlign.center),
                  ),
                  const SizedBox(height: 12),
                  ...children,
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class GateText extends StatelessWidget {
  const GateText(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: Text(
          text,
          style: AppTypography.bodyLarge.copyWith(color: AppColors.textSecondary),
          textAlign: TextAlign.center,
        ),
      );
}

class SignOutButton extends ConsumerWidget {
  const SignOutButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => TextButton(
        onPressed: () => ref.read(authControllerProvider.notifier).signOut(),
        child: const Text('Sign out'),
      );
}

/// "Check again" that keeps the screen up while it reloads.
class _CheckAgainButton extends ConsumerStatefulWidget {
  const _CheckAgainButton({required this.label});
  final String label;

  @override
  ConsumerState<_CheckAgainButton> createState() => _CheckAgainButtonState();
}

class _CheckAgainButtonState extends ConsumerState<_CheckAgainButton> {
  bool _busy = false;

  Future<void> _run() async {
    setState(() => _busy = true);
    await ref.read(sessionGateProvider.notifier).refresh(quiet: true);
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) =>
      OutlinedButton(onPressed: _busy ? null : _run, child: Text(_busy ? 'Checking…' : widget.label));
}

/// A Creator with no sign-in method yet: adds the first one here. The first
/// method needs no confirm (there's nothing to confirm with yet), comes with
/// backup codes, and completes this sign-in.
class SetupRequiredScreen extends ConsumerStatefulWidget {
  const SetupRequiredScreen({super.key});

  @override
  ConsumerState<SetupRequiredScreen> createState() => _SetupRequiredScreenState();
}

class _SetupRequiredScreenState extends ConsumerState<SetupRequiredScreen> {
  bool _busy = false;

  Future<void> _add(Future<bool> Function(MethodFlows flows, MfaStatus status) flow) async {
    final gate = ref.read(sessionGateProvider);
    if (gate is! GateSetupRequired || _busy) return;
    setState(() => _busy = true);
    try {
      final added = await flow(MethodFlows(context, ref), gate.status);
      // Backup codes were shown inside the flow; now the gate moves on.
      if (added) await ref.read(sessionGateProvider.notifier).refresh(quiet: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final gate = ref.watch(sessionGateProvider);
    final breakGlass = gate is GateSetupRequired && gate.status.breakGlass;
    return GateScaffold(
      title: 'Add a second sign-in step',
      children: [
        const GateText(
          'Creator accounts need a passkey or an authenticator app as well as a password. '
          'It keeps your seals safe if someone else learns your password.',
        ),
        GradientButton(
          text: breakGlass ? 'Add a security key' : 'Add a passkey',
          isLoading: _busy,
          onPressed: _busy ? null : () => _add((f, s) => f.addPasskey(s)),
        ),
        const SizedBox(height: 4),
        if (!breakGlass) ...[
          Text(
            'Uses Face ID or your fingerprint. Recommended.',
            style: AppTypography.bodySmall.copyWith(color: AppColors.textSecondary),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 16),
          OutlinedButton(
            onPressed: _busy ? null : () => _add((f, s) => f.addAuthenticatorApp(s)),
            child: const Text('Use an authenticator app'),
          ),
        ],
        const SizedBox(height: 12),
        const _CheckAgainButton(label: 'I set one up on the website'),
        const SizedBox(height: 8),
        const SignOutButton(),
      ],
    );
  }
}

/// Signed in, but not a Creator (the app is Creator-only, Locked 2026-10-28).
class CreatorsOnlyScreen extends ConsumerWidget {
  const CreatorsOnlyScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final links = ref.watch(webLinksProvider);
    return GateScaffold(
      title: 'This app is for creators',
      children: [
        const GateText(
          'Creators use this app to seal their pieces. Your seals, transfers and receipts '
          'are on our website.',
        ),
        GradientButton(
          text: 'Become a creator',
          onPressed: () => openExternal(context, links.becomeCreator),
        ),
        const SizedBox(height: 12),
        const _CheckAgainButton(label: 'Check again'),
        const SizedBox(height: 8),
        const SignOutButton(),
      ],
    );
  }
}

/// The gate could not load (network, server).
class SessionProblemScreen extends ConsumerWidget {
  const SessionProblemScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final gate = ref.watch(sessionGateProvider);
    final message = gate is GateError ? gate.message : 'Something went wrong. Please try again.';
    return GateScaffold(
      title: 'We couldn’t finish signing you in',
      children: [
        Semantics(liveRegion: true, child: GateText(message)),
        GradientButton(
          text: 'Try again',
          onPressed: () => ref.read(sessionGateProvider.notifier).refresh(),
        ),
        const SizedBox(height: 8),
        const SignOutButton(),
      ],
    );
  }
}
