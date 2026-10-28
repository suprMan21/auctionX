import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app_providers.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_typography.dart';
import '../../../shared/widgets/open_link.dart';
import '../../auth/presentation/widgets/gradient_button.dart';
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

/// A Creator with no sign-in method yet. Adding one moves into the app in
/// phase C; until then it happens on the website.
class SetupRequiredScreen extends ConsumerWidget {
  const SetupRequiredScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final links = ref.watch(webLinksProvider);
    return GateScaffold(
      title: 'Add a second sign-in step',
      children: [
        const GateText(
          'Creator accounts need a passkey or an authenticator app as well as a password. '
          'It keeps your seals safe if someone else learns your password.',
        ),
        const GateText('Set one up on our website, then come back here.'),
        GradientButton(
          text: 'Set it up on the website',
          onPressed: () => openExternal(context, links.securitySetup),
        ),
        const SizedBox(height: 12),
        const _CheckAgainButton(label: 'I’ve set it up'),
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
