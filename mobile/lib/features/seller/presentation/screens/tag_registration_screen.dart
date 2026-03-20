import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/constants/app_typography.dart';
import '../../../../routing/route_names.dart';
import '../../../auth/presentation/widgets/gradient_button.dart';
import '../providers/seller_provider.dart';
import '../providers/registration_wizard_state.dart';
import '../widgets/registration_step_indicator.dart';

class TagRegistrationScreen extends ConsumerStatefulWidget {
  const TagRegistrationScreen({super.key});

  @override
  ConsumerState<TagRegistrationScreen> createState() =>
      _TagRegistrationScreenState();
}

class _TagRegistrationScreenState
    extends ConsumerState<TagRegistrationScreen> {
  final _aesKeyController = TextEditingController();
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      ref.read(registrationWizardProvider.notifier).reset();
    });
  }

  @override
  void dispose() {
    _aesKeyController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  int _stepIndex(RegistrationWizardState state) {
    return state.when(
      selectListing: () => 0,
      scanTag: (_, __) => 1,
      enterKey: (_, __, ___) => 2,
      confirming: (_, __, ___, ____) => 3,
      success: (_) => 3,
      error: (_) => -1,
    );
  }

  @override
  Widget build(BuildContext context) {
    final wizardState = ref.watch(registrationWizardProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Register Tag'),
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () => context.pop(),
        ),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: RegistrationStepIndicator(
              currentStep: _stepIndex(wizardState),
              steps: const ['Select Item', 'Scan Tag', 'AES Key', 'Confirm'],
            ),
          ),
          Expanded(
            child: wizardState.when(
              selectListing: () => _buildSelectListing(),
              scanTag: (listingId, listingTitle) =>
                  _buildScanTag(listingId, listingTitle),
              enterKey: (listingId, listingTitle, tagUid) =>
                  _buildEnterKey(listingId, listingTitle, tagUid),
              confirming: (listingId, listingTitle, tagUid, aesKey) =>
                  _buildConfirming(listingId, listingTitle, tagUid, aesKey),
              success: (result) => _buildSuccess(result),
              error: (message) => _buildError(message),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSelectListing() {
    final listingsAsync = ref.watch(sellerListingsProvider);

    return listingsAsync.when(
      loading: () => const Center(
        child: CircularProgressIndicator(color: AppColors.primary500),
      ),
      error: (e, _) => Center(
        child: Text('Error loading listings: $e',
            style: AppTypography.bodyMedium.copyWith(color: AppColors.error)),
      ),
      data: (listings) {
        final query = _searchController.text.toLowerCase();
        final filtered = query.isEmpty
            ? listings
            : listings
                .where((l) =>
                    (l['title'] as String? ?? '')
                        .toLowerCase()
                        .contains(query))
                .toList();

        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Select a listing to tag',
                  style: AppTypography.titleMedium),
              const SizedBox(height: 12),
              TextField(
                controller: _searchController,
                onChanged: (_) => setState(() {}),
                style: AppTypography.bodyMedium,
                decoration: InputDecoration(
                  hintText: 'Search listings...',
                  hintStyle: AppTypography.bodyMedium
                      .copyWith(color: AppColors.textTertiary),
                  prefixIcon: const Icon(Icons.search,
                      color: AppColors.textTertiary),
                  filled: true,
                  fillColor: AppColors.surfaceLight,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Expanded(
                child: filtered.isEmpty
                    ? Center(
                        child: Text('No listings found',
                            style: AppTypography.bodyMedium
                                .copyWith(color: AppColors.textTertiary)),
                      )
                    : ListView.separated(
                        itemCount: filtered.length,
                        separatorBuilder: (_, __) =>
                            const SizedBox(height: 8),
                        itemBuilder: (context, index) {
                          final listing = filtered[index];
                          return _ListingTile(
                            title: listing['title'] as String? ?? 'Untitled',
                            status: listing['status'] as String? ?? '',
                            onTap: () {
                              ref
                                  .read(registrationWizardProvider.notifier)
                                  .selectListing(
                                    listing['id'] as String,
                                    listing['title'] as String? ?? 'Untitled',
                                  );
                            },
                          );
                        },
                      ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildScanTag(String listingId, String listingTitle) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 120,
            height: 120,
            decoration: BoxDecoration(
              color: AppColors.glassBg,
              shape: BoxShape.circle,
              border: Border.all(color: AppColors.glassBorder, width: 2),
            ),
            child: ShaderMask(
              shaderCallback: (bounds) =>
                  AppColors.primaryGradient.createShader(bounds),
              child: const Icon(Icons.nfc, color: Colors.white, size: 56),
            ),
          ),
          const SizedBox(height: 24),
          Text('Scan NFC Tag', style: AppTypography.headlineSmall),
          const SizedBox(height: 8),
          Text(
            'Hold your device near the NTAG 424 DNA tag',
            style: AppTypography.bodyMedium
                .copyWith(color: AppColors.textSecondary),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: AppColors.surfaceLight,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              listingTitle,
              style: AppTypography.labelLarge
                  .copyWith(color: AppColors.accent400),
            ),
          ),
          const SizedBox(height: 32),
          GradientButton(
            text: 'Start Scanning',
            onPressed: () {
              ref
                  .read(registrationWizardProvider.notifier)
                  .scanTag(listingId, listingTitle);
            },
          ),
        ],
      ),
    );
  }

  Widget _buildEnterKey(
      String listingId, String listingTitle, String tagUid) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Tag Scanned', style: AppTypography.titleMedium),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.surfaceLight,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              children: [
                const Icon(Icons.check_circle,
                    color: AppColors.success, size: 20),
                const SizedBox(width: 8),
                Text('UID: $tagUid',
                    style: AppTypography.bodyMedium
                        .copyWith(fontFamily: 'monospace')),
              ],
            ),
          ),
          const SizedBox(height: 24),
          Text('Enter AES Key', style: AppTypography.titleMedium),
          const SizedBox(height: 8),
          Text(
            '32 hexadecimal characters from tag packaging',
            style: AppTypography.bodySmall
                .copyWith(color: AppColors.textSecondary),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _aesKeyController,
            style: AppTypography.bodyMedium.copyWith(fontFamily: 'monospace'),
            maxLength: 32,
            textCapitalization: TextCapitalization.characters,
            decoration: InputDecoration(
              hintText: '00112233445566778899AABBCCDDEEFF',
              hintStyle: AppTypography.bodyMedium
                  .copyWith(color: AppColors.textTertiary),
              filled: true,
              fillColor: AppColors.surfaceLight,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide.none,
              ),
              counterStyle:
                  AppTypography.bodySmall.copyWith(color: AppColors.textTertiary),
            ),
          ),
          const Spacer(),
          GradientButton(
            text: 'Continue',
            onPressed: () {
              final key = _aesKeyController.text.trim();
              if (key.length != 32 ||
                  !RegExp(r'^[0-9A-Fa-f]{32}$').hasMatch(key)) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('AES key must be 32 hex characters'),
                    backgroundColor: AppColors.error,
                  ),
                );
                return;
              }
              ref
                  .read(registrationWizardProvider.notifier)
                  .enterAesKey(
                    listingId: listingId,
                    listingTitle: listingTitle,
                    tagUid: tagUid,
                    aesKey: key.toUpperCase(),
                  );
            },
          ),
        ],
      ),
    );
  }

  Widget _buildConfirming(
      String listingId, String listingTitle, String tagUid, String aesKey) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Confirm Registration', style: AppTypography.titleMedium),
          const SizedBox(height: 16),
          _ConfirmRow(label: 'Listing', value: listingTitle),
          const SizedBox(height: 12),
          _ConfirmRow(label: 'Tag UID', value: tagUid),
          const SizedBox(height: 12),
          _ConfirmRow(
              label: 'AES Key',
              value: '${aesKey.substring(0, 8)}...${aesKey.substring(24)}'),
          const Spacer(),
          GradientButton(
            text: 'Register Tag',
            onPressed: () {
              ref
                  .read(registrationWizardProvider.notifier)
                  .confirmRegistration(
                    listingId: listingId,
                    tagUid: tagUid,
                    aesKey: aesKey,
                  );
            },
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: TextButton(
              onPressed: () =>
                  ref.read(registrationWizardProvider.notifier).reset(),
              child: Text('Start Over',
                  style: AppTypography.bodyMedium
                      .copyWith(color: AppColors.textSecondary)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSuccess(dynamic result) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 80,
            height: 80,
            decoration: const BoxDecoration(
              color: AppColors.success,
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.check, color: Colors.white, size: 40),
          ),
          const SizedBox(height: 24),
          Text('Tag Registered!', style: AppTypography.headlineSmall),
          const SizedBox(height: 8),
          Text(
            'Your NFC tag has been successfully linked to the listing.',
            style: AppTypography.bodyMedium
                .copyWith(color: AppColors.textSecondary),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 32),
          GradientButton(
            text: 'View QR Code',
            onPressed: () {
              context.pushReplacement(
                  '${RouteNames.sellerQr}/${result.tagId}');
            },
          ),
          const SizedBox(height: 12),
          TextButton(
            onPressed: () => context.pop(),
            child: Text('Back to Dashboard',
                style: AppTypography.bodyMedium
                    .copyWith(color: AppColors.textSecondary)),
          ),
        ],
      ),
    );
  }

  Widget _buildError(String message) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline, color: AppColors.error, size: 64),
          const SizedBox(height: 16),
          Text(message,
              style: AppTypography.bodyMedium.copyWith(color: AppColors.error),
              textAlign: TextAlign.center),
          const SizedBox(height: 24),
          GradientButton(
            text: 'Try Again',
            onPressed: () =>
                ref.read(registrationWizardProvider.notifier).reset(),
          ),
        ],
      ),
    );
  }
}

class _ListingTile extends StatelessWidget {
  final String title;
  final String status;
  final VoidCallback onTap;

  const _ListingTile({
    required this.title,
    required this.status,
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
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.glassBorder),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: AppTypography.titleMedium),
                  const SizedBox(height: 4),
                  Text(status,
                      style: AppTypography.bodySmall
                          .copyWith(color: AppColors.textTertiary)),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, color: AppColors.textTertiary),
          ],
        ),
      ),
    );
  }
}

class _ConfirmRow extends StatelessWidget {
  final String label;
  final String value;

  const _ConfirmRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surfaceLight,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label,
              style: AppTypography.bodySmall
                  .copyWith(color: AppColors.textSecondary)),
          Flexible(
            child: Text(value,
                style: AppTypography.bodyMedium,
                overflow: TextOverflow.ellipsis),
          ),
        ],
      ),
    );
  }
}
