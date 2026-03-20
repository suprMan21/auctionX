import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';
import '../../../../routing/route_names.dart';
import '../providers/seller_provider.dart';
import '../providers/seller_state.dart';
import '../widgets/seller_tag_card.dart';
import '../widgets/status_filter_chips.dart';

class SellerDashboardScreen extends ConsumerStatefulWidget {
  const SellerDashboardScreen({super.key});

  @override
  ConsumerState<SellerDashboardScreen> createState() =>
      _SellerDashboardScreenState();
}

class _SellerDashboardScreenState extends ConsumerState<SellerDashboardScreen> {
  String _activeFilter = 'all';

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      ref.read(sellerNotifierProvider.notifier).loadTags();
    });
  }

  @override
  Widget build(BuildContext context) {
    final sellerState = ref.watch(sellerNotifierProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Seller Tools'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: () => context.push(RouteNames.sellerRegister),
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Row(
              children: [
                Expanded(
                  child: _ActionCard(
                    icon: Icons.nfc,
                    label: 'Register Tag',
                    onTap: () => context.push(RouteNames.sellerRegister),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _ActionCard(
                    icon: Icons.dynamic_feed,
                    label: 'Batch Register',
                    onTap: () => context.push(RouteNames.sellerBatchRegister),
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: StatusFilterChips(
              activeFilter: _activeFilter,
              onFilterChanged: (filter) {
                setState(() => _activeFilter = filter);
              },
            ),
          ),
          Expanded(
            child: sellerState.when(
              initial: () => const Center(
                child: CircularProgressIndicator(color: AppColors.primary500),
              ),
              loading: () => const Center(
                child: CircularProgressIndicator(color: AppColors.primary500),
              ),
              error: (message) => Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(message,
                        style: AppTypography.bodyMedium
                            .copyWith(color: AppColors.error)),
                    const SizedBox(height: 16),
                    TextButton(
                      onPressed: () =>
                          ref.read(sellerNotifierProvider.notifier).loadTags(),
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              ),
              loaded: (tags) {
                final filtered = _activeFilter == 'all'
                    ? tags
                    : tags
                        .where((t) =>
                            t.status.toLowerCase() == _activeFilter)
                        .toList();

                if (filtered.isEmpty) {
                  return Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.inventory_2_outlined,
                            size: 64, color: AppColors.textTertiary),
                        const SizedBox(height: 16),
                        Text(
                          _activeFilter == 'all'
                              ? 'No tags registered yet'
                              : 'No $_activeFilter tags',
                          style: AppTypography.bodyLarge
                              .copyWith(color: AppColors.textSecondary),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Register your first NFC tag to get started',
                          style: AppTypography.bodySmall
                              .copyWith(color: AppColors.textTertiary),
                        ),
                      ],
                    ),
                  );
                }

                return RefreshIndicator(
                  color: AppColors.primary500,
                  onRefresh: () =>
                      ref.read(sellerNotifierProvider.notifier).loadTags(),
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: filtered.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (context, index) {
                      final tag = filtered[index];
                      return SellerTagCard(
                        tag: tag,
                        onTap: () => context.push(
                          '${RouteNames.sellerQr}/${tag.id}',
                        ),
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _ActionCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _ActionCard({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.glassBg,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.glassBorder),
        ),
        child: Column(
          children: [
            ShaderMask(
              shaderCallback: (bounds) =>
                  AppColors.primaryGradient.createShader(bounds),
              child: Icon(icon, color: Colors.white, size: 32),
            ),
            const SizedBox(height: 8),
            Text(label, style: AppTypography.labelLarge),
          ],
        ),
      ),
    );
  }
}
