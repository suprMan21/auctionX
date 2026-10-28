import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app_providers.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_typography.dart';
import '../../routing/route_names.dart';
import '../auth/data/auth_service.dart';

/// Signed-in home. Sealing arrives in S-MOB2.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final email = auth is SignedIn ? auth.user.email : '';

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
                      'Recording a seal is coming to this app soon.',
                      style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary),
                    ),
                  ],
                ),
              ),
            ),
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
          ],
        ),
      ),
    );
  }
}
