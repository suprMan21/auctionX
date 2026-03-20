import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';

class LegalViewerScreen extends StatefulWidget {
  final String title;
  final String assetPath;

  const LegalViewerScreen({
    super.key,
    required this.title,
    required this.assetPath,
  });

  @override
  State<LegalViewerScreen> createState() => _LegalViewerScreenState();
}

class _LegalViewerScreenState extends State<LegalViewerScreen> {
  String _content = '';
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadContent();
  }

  Future<void> _loadContent() async {
    try {
      final text = await rootBundle.loadString(widget.assetPath);
      setState(() {
        _content = text;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _content = 'Failed to load document.';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: AppColors.primary500),
            )
          : SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Text(
                _content,
                style: AppTypography.bodyMedium
                    .copyWith(color: AppColors.textSecondary, height: 1.6),
              ),
            ),
    );
  }
}
