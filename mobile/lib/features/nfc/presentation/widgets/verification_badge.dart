import 'package:flutter/material.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';

enum VerificationStatus {
  verified,
  active,
  registered,
  invalid,
}

class VerificationBadge extends StatelessWidget {
  final VerificationStatus status;

  const VerificationBadge({super.key, required this.status});

  @override
  Widget build(BuildContext context) {
    final (color, icon, label) = switch (status) {
      VerificationStatus.verified => (AppColors.success, Icons.check_circle, 'Verified'),
      VerificationStatus.active => (AppColors.accent500, Icons.nfc, 'Active'),
      VerificationStatus.registered => (AppColors.textTertiary, Icons.schedule, 'Registered'),
      VerificationStatus.invalid => (AppColors.error, Icons.cancel, 'Invalid'),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: 16),
          const SizedBox(width: 6),
          Text(
            label,
            style: AppTypography.labelSmall.copyWith(color: color),
          ),
        ],
      ),
    );
  }
}
