import 'dart:ui' as ui;
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';

class ShareSheet extends StatelessWidget {
  final String tagId;
  final GlobalKey _cardKey = GlobalKey();

  ShareSheet({super.key, required this.tagId});

  String get _verifyUrl => 'https://authentic-materials.com/verify/$tagId';

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Handle
          Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: AppColors.textTertiary,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(height: 20),
          Text('Share Verification', style: AppTypography.titleLarge),
          const SizedBox(height: 24),

          _shareOption(
            context,
            icon: Icons.link,
            label: 'Share Link',
            onTap: () {
              SharePlus.instance.share(
                ShareParams(text: 'Check out this verified item: $_verifyUrl'),
              );
              Navigator.of(context).pop();
            },
          ),
          _shareOption(
            context,
            icon: Icons.image,
            label: 'Share as Image',
            onTap: () async {
              await _shareAsImage(context);
              if (context.mounted) Navigator.of(context).pop();
            },
          ),
          _shareOption(
            context,
            icon: Icons.camera_alt,
            label: 'Instagram Stories',
            onTap: () {
              SharePlus.instance.share(
                ShareParams(text: 'Verified on Authentic Materials $_verifyUrl'),
              );
              Navigator.of(context).pop();
            },
          ),
          _shareOption(
            context,
            icon: Icons.alternate_email,
            label: 'Twitter / X',
            onTap: () {
              SharePlus.instance.share(
                ShareParams(
                    text:
                        'Just verified this item on Authentic Materials! $_verifyUrl'),
              );
              Navigator.of(context).pop();
            },
          ),
          _shareOption(
            context,
            icon: Icons.copy,
            label: 'Copy Link',
            onTap: () {
              Clipboard.setData(ClipboardData(text: _verifyUrl));
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Link copied to clipboard'),
                  duration: Duration(seconds: 2),
                ),
              );
              Navigator.of(context).pop();
            },
          ),
          const SizedBox(height: 16),
        ],
      ),
    );
  }

  Widget _shareOption(
    BuildContext context, {
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Container(
        width: 44,
        height: 44,
        decoration: BoxDecoration(
          color: AppColors.glassBg,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.glassBorder),
        ),
        child: Icon(icon, color: AppColors.textPrimary, size: 22),
      ),
      title: Text(label, style: AppTypography.bodyLarge),
      trailing: const Icon(Icons.chevron_right, color: AppColors.textTertiary),
      onTap: onTap,
    );
  }

  Future<void> _shareAsImage(BuildContext context) async {
    try {
      final boundary = _cardKey.currentContext?.findRenderObject()
          as RenderRepaintBoundary?;
      if (boundary == null) {
        SharePlus.instance.share(ShareParams(text: _verifyUrl));
        return;
      }

      final image = await boundary.toImage(pixelRatio: 3.0);
      final byteData =
          await image.toByteData(format: ui.ImageByteFormat.png);
      if (byteData == null) return;

      final tempDir = await getTemporaryDirectory();
      final file = File('${tempDir.path}/verification_$tagId.png');
      await file.writeAsBytes(byteData.buffer.asUint8List());

      SharePlus.instance.share(
        ShareParams(
          files: [XFile(file.path)],
          text: 'Verified on Authentic Materials',
        ),
      );
    } catch (_) {
      SharePlus.instance.share(ShareParams(text: _verifyUrl));
    }
  }
}
