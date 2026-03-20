import 'package:flutter/material.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';

class StatusFilterChips extends StatelessWidget {
  final String activeFilter;
  final ValueChanged<String> onFilterChanged;

  const StatusFilterChips({
    super.key,
    required this.activeFilter,
    required this.onFilterChanged,
  });

  static const _filters = ['all', 'active', 'pending', 'sold'];

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: _filters.map((filter) {
          final isActive = filter == activeFilter;
          return Padding(
            padding: const EdgeInsets.only(right: 8),
            child: GestureDetector(
              onTap: () => onFilterChanged(filter),
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                decoration: BoxDecoration(
                  color: isActive
                      ? AppColors.primary500.withValues(alpha: 0.2)
                      : AppColors.surfaceLight,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: isActive
                        ? AppColors.primary500
                        : AppColors.glassBorder,
                  ),
                ),
                child: Text(
                  filter[0].toUpperCase() + filter.substring(1),
                  style: AppTypography.labelLarge.copyWith(
                    color: isActive
                        ? AppColors.primary500
                        : AppColors.textSecondary,
                    fontSize: 13,
                  ),
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}
