import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/constants/api_constants.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';
import '../../../auth/presentation/widgets/gradient_button.dart';
import '../../../nfc/data/services/nfc_service.dart';
import '../providers/seller_provider.dart';

class BatchRegistrationScreen extends ConsumerStatefulWidget {
  const BatchRegistrationScreen({super.key});

  @override
  ConsumerState<BatchRegistrationScreen> createState() =>
      _BatchRegistrationScreenState();
}

class _BatchRegistrationScreenState
    extends ConsumerState<BatchRegistrationScreen> {
  final List<Map<String, String>> _selectedListings = [];
  int _currentIndex = 0;
  int _registeredCount = 0;
  bool _isScanning = false;
  bool _isSelecting = true;
  String? _error;
  final _aesKeyController = TextEditingController();

  late final NfcService _nfcService;

  @override
  void initState() {
    super.initState();
    _nfcService =
        ApiConstants.kUseMockNfc ? MockNfcService() : NfcServiceImpl();
  }

  @override
  void dispose() {
    _aesKeyController.dispose();
    super.dispose();
  }

  Future<void> _scanAndRegister() async {
    if (_currentIndex >= _selectedListings.length) return;

    setState(() {
      _isScanning = true;
      _error = null;
    });

    try {
      final scanData = await _nfcService.startSession();

      // Prompt for AES key
      if (!mounted) return;
      final aesKey = await _showAesKeyDialog();
      if (aesKey == null) {
        setState(() => _isScanning = false);
        return;
      }

      final listing = _selectedListings[_currentIndex];
      final result = await ref.read(sellerRepositoryProvider).registerTag(
            tagUid: scanData.tagUid,
            aesKey: aesKey,
            itemId: listing['id']!,
            tenantId: 'authentic-materials',
          );

      result.fold(
        (failure) {
          setState(() {
            _error = failure.message;
            _isScanning = false;
          });
        },
        (_) {
          setState(() {
            _registeredCount++;
            _currentIndex++;
            _isScanning = false;
          });

          if (_currentIndex >= _selectedListings.length) {
            _showCompletionDialog();
          }
        },
      );
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isScanning = false;
      });
    }
  }

  Future<String?> _showAesKeyDialog() async {
    _aesKeyController.clear();
    return showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: Text('Enter AES Key', style: AppTypography.titleMedium),
        content: TextField(
          controller: _aesKeyController,
          style: AppTypography.bodyMedium.copyWith(fontFamily: 'monospace'),
          maxLength: 32,
          textCapitalization: TextCapitalization.characters,
          decoration: InputDecoration(
            hintText: '32 hex characters',
            hintStyle: AppTypography.bodyMedium
                .copyWith(color: AppColors.textTertiary),
            filled: true,
            fillColor: AppColors.surfaceLight,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide.none,
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () {
              final key = _aesKeyController.text.trim();
              if (key.length == 32 &&
                  RegExp(r'^[0-9A-Fa-f]{32}$').hasMatch(key)) {
                Navigator.pop(ctx, key.toUpperCase());
              }
            },
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
  }

  void _showCompletionDialog() {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: Text('Batch Complete!', style: AppTypography.titleMedium),
        content: Text(
          '$_registeredCount of ${_selectedListings.length} tags registered.',
          style: AppTypography.bodyMedium,
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              context.pop();
            },
            child: const Text('Done'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_isSelecting) {
      return _buildSelectionPhase();
    }
    return _buildScanningPhase();
  }

  Widget _buildSelectionPhase() {
    final listingsAsync = ref.watch(sellerListingsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Batch Register')),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(
              'Select listings to register (${_selectedListings.length} selected)',
              style: AppTypography.titleMedium,
            ),
          ),
          Expanded(
            child: listingsAsync.when(
              loading: () => const Center(
                child: CircularProgressIndicator(color: AppColors.primary500),
              ),
              error: (e, _) => Center(child: Text('$e')),
              data: (listings) => ListView.builder(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                itemCount: listings.length,
                itemBuilder: (context, index) {
                  final listing = listings[index];
                  final id = listing['id'] as String;
                  final title = listing['title'] as String? ?? 'Untitled';
                  final isSelected =
                      _selectedListings.any((l) => l['id'] == id);

                  return CheckboxListTile(
                    title: Text(title, style: AppTypography.bodyMedium),
                    value: isSelected,
                    activeColor: AppColors.primary500,
                    checkColor: Colors.white,
                    onChanged: (checked) {
                      setState(() {
                        if (checked == true) {
                          _selectedListings
                              .add({'id': id, 'title': title});
                        } else {
                          _selectedListings
                              .removeWhere((l) => l['id'] == id);
                        }
                      });
                    },
                  );
                },
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: GradientButton(
              text: 'Start Scanning (${_selectedListings.length})',
              onPressed: _selectedListings.isEmpty
                  ? null
                  : () => setState(() => _isSelecting = false),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildScanningPhase() {
    final current = _currentIndex < _selectedListings.length
        ? _selectedListings[_currentIndex]
        : null;

    return Scaffold(
      appBar: AppBar(
        title: Text(
            '$_registeredCount of ${_selectedListings.length} registered'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Progress
            LinearProgressIndicator(
              value: _selectedListings.isEmpty
                  ? 0
                  : _registeredCount / _selectedListings.length,
              backgroundColor: AppColors.surfaceLight,
              valueColor:
                  const AlwaysStoppedAnimation<Color>(AppColors.primary500),
              minHeight: 8,
              borderRadius: BorderRadius.circular(4),
            ),
            const SizedBox(height: 32),
            if (current != null) ...[
              Text('Next: ${current['title']}',
                  style: AppTypography.titleMedium),
              const SizedBox(height: 24),
              if (_isScanning)
                const CircularProgressIndicator(color: AppColors.primary500)
              else
                GradientButton(
                  text: 'Scan Tag #${_currentIndex + 1}',
                  onPressed: _scanAndRegister,
                ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 16),
              Text(_error!,
                  style: AppTypography.bodySmall
                      .copyWith(color: AppColors.error)),
            ],
            const SizedBox(height: 32),
            TextButton(
              onPressed: () {
                if (_registeredCount > 0) {
                  _showCompletionDialog();
                } else {
                  context.pop();
                }
              },
              child: Text(
                _registeredCount > 0 ? 'Finish Early' : 'Cancel',
                style: AppTypography.bodyMedium
                    .copyWith(color: AppColors.textSecondary),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
