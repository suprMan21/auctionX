import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_typography.dart';
import '../../auth/presentation/widgets/gradient_button.dart';
import '../data/seal_tap.dart';
import '../seal_providers.dart';
import '../seal_copy.dart';

/// Test builds only (S-MOB2 Ph B gate): does one app read raise the chip's counter by exactly one?
///
/// Reads the same seal twice, exactly the way a take does, and hands both URLs to the Mac, where
/// `tag_encoder.cli verify --kms --url …` decrypts each counter. Sends nothing to the server and
/// doesn't use the seal.
class ReadCheckScreen extends ConsumerStatefulWidget {
  const ReadCheckScreen({super.key});

  @override
  ConsumerState<ReadCheckScreen> createState() => _ReadCheckScreenState();
}

class _ReadCheckScreenState extends ConsumerState<ReadCheckScreen> {
  final List<SealTap> _reads = [];
  String? _note;
  bool _busy = false;

  Future<void> _read() async {
    setState(() {
      _busy = true;
      _note = null;
    });
    try {
      final url = await ref.read(sealReaderProvider).readUrl(prompt: 'Read ${_reads.length + 1} of 2');
      final tap = parseSealTap(url, DateTime.now());
      if (_reads.isNotEmpty && _reads.first.serial != tap.serial) {
        setState(() => _note = 'That’s a different seal. Use the same seal for both reads.');
        return;
      }
      setState(() => _reads.add(tap));
    } catch (e) {
      setState(() => _note = readFailureCopy(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String get _report {
    final b = StringBuffer('S-MOB2 read check, ${DateTime.now().toIso8601String()}\n');
    for (var i = 0; i < _reads.length; i++) {
      b
        ..writeln()
        ..writeln('Read ${i + 1}:')
        ..writeln('.venv/bin/python -m tag_encoder.cli verify --kms --url \'${_reads[i].url}\'');
    }
    b
      ..writeln()
      ..writeln('Pass: the two counterValue numbers differ by exactly 1.');
    return b.toString();
  }

  @override
  Widget build(BuildContext context) {
    final done = _reads.length >= 2;
    return Scaffold(
      appBar: AppBar(title: const Text('Read check')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Text('Test builds only', style: AppTypography.labelSmall.copyWith(color: AppColors.warning)),
            const SizedBox(height: 8),
            Text(
              'Read the same seal twice. A take needs each read to raise the seal’s counter by exactly one; '
              'your Mac checks that from the two links. Nothing is sent to Authentic Materials.',
              style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary),
            ),
            const SizedBox(height: 20),
            for (var i = 0; i < _reads.length; i++)
              Card(
                child: ListTile(
                  title: Text('Read ${i + 1} · seal …${serialSuffix(_reads[i].serial)}'),
                  subtitle: Text(_reads[i].url, maxLines: 2, overflow: TextOverflow.ellipsis),
                ),
              ),
            if (_note != null)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Text(_note!, style: AppTypography.bodyMedium.copyWith(color: AppColors.warning)),
              ),
            const SizedBox(height: 12),
            if (!done)
              GradientButton(
                text: 'Read ${_reads.length + 1} of 2',
                isLoading: _busy,
                onPressed: _busy ? null : _read,
              )
            else ...[
              GradientButton(
                text: 'Send to my Mac',
                onPressed: () => SharePlus.instance.share(ShareParams(text: _report, subject: 'S-MOB2 read check')),
              ),
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: () async {
                  await Clipboard.setData(ClipboardData(text: _report));
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Copied')));
                  }
                },
                child: const Text('Copy'),
              ),
              TextButton(onPressed: () => setState(_reads.clear), child: const Text('Start over')),
            ],
          ],
        ),
      ),
    );
  }
}
