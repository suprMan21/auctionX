import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';
import '../../../auth/domain/entities/user_entity.dart';
import '../../../auth/presentation/providers/auth_provider.dart';
import '../../../auth/presentation/providers/auth_state.dart';
import '../../../auth/presentation/widgets/gradient_button.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authNotifierProvider);

    final email = authState.maybeWhen(
      authenticated: (UserEntity user) => user.email,
      orElse: () => '',
    );

    final displayName = authState.maybeWhen(
      authenticated: (UserEntity user) => user.displayName,
      orElse: () => null,
    );

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const SizedBox(height: 24),
            // Avatar
            Container(
              width: 80,
              height: 80,
              decoration: BoxDecoration(
                color: AppColors.surfaceLight,
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.glassBorder),
              ),
              child: const Icon(
                Icons.person,
                color: AppColors.textTertiary,
                size: 40,
              ),
            ),
            const SizedBox(height: 16),
            if (displayName != null) ...[
              Text(displayName, style: AppTypography.titleLarge),
              const SizedBox(height: 4),
            ],
            Text(
              email,
              style: AppTypography.bodyMedium
                  .copyWith(color: AppColors.textSecondary),
            ),
            const SizedBox(height: 32),
            // Settings card
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.glassBg,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: AppColors.glassBorder),
              ),
              child: Column(
                children: [
                  _SettingsTile(
                    icon: Icons.settings_outlined,
                    title: 'Settings',
                    onTap: () {},
                  ),
                  const Divider(color: AppColors.glassBorder, height: 1),
                  _SettingsTile(
                    icon: Icons.help_outline,
                    title: 'Help & Support',
                    onTap: () {},
                  ),
                ],
              ),
            ),
            const Spacer(),
            GradientButton(
              text: 'Sign Out',
              onPressed: () {
                ref.read(authNotifierProvider.notifier).signOut();
              },
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }
}

class _SettingsTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final VoidCallback onTap;

  const _SettingsTile({
    required this.icon,
    required this.title,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, color: AppColors.textSecondary),
      title: Text(title, style: AppTypography.bodyMedium),
      trailing:
          const Icon(Icons.chevron_right, color: AppColors.textTertiary),
      onTap: onTap,
      contentPadding: EdgeInsets.zero,
    );
  }
}
