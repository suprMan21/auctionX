import 'package:flutter/material.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';

class BrowseScreen extends StatelessWidget {
  const BrowseScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: ShaderMask(
          shaderCallback: (bounds) =>
              AppColors.primaryGradient.createShader(bounds),
          child: Text('AuctionX',
              style:
                  AppTypography.headlineSmall.copyWith(color: Colors.white)),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.search, color: AppColors.textSecondary),
            onPressed: () {},
          ),
        ],
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.storefront_outlined,
                size: 64, color: AppColors.textTertiary),
            const SizedBox(height: 16),
            Text(
              'Marketplace coming soon',
              style: AppTypography.titleMedium
                  .copyWith(color: AppColors.textSecondary),
            ),
            const SizedBox(height: 8),
            Text(
              'Browse auctions and verified items',
              style: AppTypography.bodySmall
                  .copyWith(color: AppColors.textTertiary),
            ),
          ],
        ),
      ),
    );
  }
}
