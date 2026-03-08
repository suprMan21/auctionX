import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_typography.dart';
import '../../routing/route_names.dart';

class AppScaffold extends StatelessWidget {
  final Widget child;

  const AppScaffold({super.key, required this.child});

  int _currentIndex(BuildContext context) {
    final location = GoRouterState.of(context).uri.path;
    if (location.startsWith(RouteNames.nfc)) return 1;
    if (location.startsWith(RouteNames.activity)) return 2;
    if (location.startsWith(RouteNames.profile)) return 3;
    return 0;
  }

  void _onTap(BuildContext context, int index) {
    switch (index) {
      case 0:
        context.go(RouteNames.browse);
      case 1:
        context.go(RouteNames.nfc);
      case 2:
        context.go(RouteNames.activity);
      case 3:
        context.go(RouteNames.profile);
    }
  }

  @override
  Widget build(BuildContext context) {
    final currentIndex = _currentIndex(context);

    return Scaffold(
      body: child,
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          border: Border(
            top: BorderSide(color: AppColors.glassBorder),
          ),
        ),
        child: SafeArea(
          child: SizedBox(
            height: 64,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _NavItem(
                  icon: Icons.explore_outlined,
                  activeIcon: Icons.explore,
                  label: 'Browse',
                  isActive: currentIndex == 0,
                  onTap: () => _onTap(context, 0),
                ),
                _NavItem(
                  icon: Icons.nfc_outlined,
                  activeIcon: Icons.nfc,
                  label: 'Scan',
                  isActive: currentIndex == 1,
                  isHero: true,
                  onTap: () => _onTap(context, 1),
                ),
                _NavItem(
                  icon: Icons.notifications_outlined,
                  activeIcon: Icons.notifications,
                  label: 'Activity',
                  isActive: currentIndex == 2,
                  onTap: () => _onTap(context, 2),
                ),
                _NavItem(
                  icon: Icons.person_outline,
                  activeIcon: Icons.person,
                  label: 'Profile',
                  isActive: currentIndex == 3,
                  onTap: () => _onTap(context, 3),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  final IconData icon;
  final IconData activeIcon;
  final String label;
  final bool isActive;
  final bool isHero;
  final VoidCallback onTap;

  const _NavItem({
    required this.icon,
    required this.activeIcon,
    required this.label,
    required this.isActive,
    this.isHero = false,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = isActive
        ? (isHero ? AppColors.accent500 : AppColors.primary500)
        : AppColors.textTertiary;

    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: SizedBox(
        width: 64,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (isHero && isActive)
              ShaderMask(
                shaderCallback: (bounds) =>
                    AppColors.primaryGradient.createShader(bounds),
                child: Icon(activeIcon, color: Colors.white, size: 28),
              )
            else
              Icon(isActive ? activeIcon : icon, color: color, size: 24),
            const SizedBox(height: 4),
            Text(
              label,
              style: AppTypography.labelSmall.copyWith(
                color: color,
                fontSize: 10,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
