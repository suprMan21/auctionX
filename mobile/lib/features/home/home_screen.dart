import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app_providers.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_typography.dart';
import '../../routing/route_names.dart';
import '../auth/data/auth_service.dart';
import '../auth/presentation/widgets/gradient_button.dart';
import '../seal/data/pending_seal.dart';
import '../seal/data/seal_tap.dart';
import '../seal/seal_providers.dart';

/// Signed-in home: seal a piece, finish seals still on this phone, security.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final email = auth is SignedIn ? auth.user.email : '';
    final testBuild = !ref.watch(appConfigProvider).isProd;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Authentic Materials'),
        actions: [
          TextButton(
            onPressed: () => ref.read(authControllerProvider.notifier).signOut(),
            child: const Text('Sign out'),
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Text('Signed in as', style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary)),
            const SizedBox(height: 4),
            Text(email, style: AppTypography.titleMedium),
            const SizedBox(height: 32),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Semantics(header: true, child: Text('Seal a piece', style: AppTypography.titleLarge)),
                    const SizedBox(height: 8),
                    Text(
                      'Record yourself applying a seal. Two taps of the seal bracket the video.',
                      style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary),
                    ),
                    const SizedBox(height: 16),
                    GradientButton(text: 'Seal a piece', onPressed: () => context.push(RouteNames.sealPrep)),
                  ],
                ),
              ),
            ),
            ..._pendingSeals(context, ref),
            const SizedBox(height: 16),
            Card(
              child: ListTile(
                contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                leading: const Icon(Icons.shield_outlined, color: AppColors.accent400),
                title: Text('Security', style: AppTypography.titleMedium),
                subtitle: Text(
                  'Passkeys, authenticator app, backup codes',
                  style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary),
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push(RouteNames.security),
              ),
            ),
            if (testBuild) ...[
              const SizedBox(height: 16),
              Card(
                child: ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                  leading: const Icon(Icons.verified_outlined, color: AppColors.accent400),
                  title: Text('Seal preview', style: AppTypography.titleMedium),
                  subtitle: Text(
                    'Test builds only',
                    style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary),
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.push(RouteNames.sealPreview),
                ),
              ),
              const SizedBox(height: 16),
              Card(
                child: ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                  leading: const Icon(Icons.nfc, color: AppColors.accent400),
                  title: Text('Read check', style: AppTypography.titleMedium),
                  subtitle: Text(
                    'Test builds only: one read = counter + 1',
                    style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary),
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.push(RouteNames.readCheck),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// Seals still on this phone: waiting to finish, or refused (so the creator sees why).
  List<Widget> _pendingSeals(BuildContext context, WidgetRef ref) {
    final seals = ref.watch(pendingSealsProvider).valueOrNull ?? const <PendingSeal>[];
    final open = [for (final s in seals) if (s.state != PendingSealState.sealed) s];
    if (open.isEmpty) return const [];
    return [
      const SizedBox(height: 16),
      for (final s in open)
        Card(
          child: ListTile(
            contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
            leading: Icon(
              s.state == PendingSealState.refused ? Icons.error_outline : Icons.sync,
              color: s.state == PendingSealState.refused ? AppColors.warning : AppColors.accent400,
            ),
            title: Text(
              s.state == PendingSealState.refused ? 'Seal couldn’t be finished' : 'Finish your seal',
              style: AppTypography.titleMedium,
            ),
            subtitle: Text(
              'Seal ending in ${serialSuffix(s.serial)}',
              style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary),
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push(RouteNames.sealResult, extra: s.id),
          ),
        ),
    ];
  }
}
