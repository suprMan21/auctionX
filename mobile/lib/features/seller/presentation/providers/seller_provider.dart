import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../../../../core/constants/api_constants.dart';
import '../../../../core/network/api_client.dart';
import '../../../nfc/data/services/nfc_service.dart';
import '../../data/datasources/seller_remote_datasource.dart';
import '../../data/repositories/seller_repository_impl.dart';
import '../../domain/repositories/seller_repository.dart';
import 'seller_state.dart';
import 'registration_wizard_state.dart';

final sellerDatasourceProvider = Provider<SellerRemoteDatasource>((ref) {
  return SellerRemoteDatasource(ApiClient(), Supabase.instance.client);
});

final sellerRepositoryProvider = Provider<SellerRepository>((ref) {
  return SellerRepositoryImpl(ref.watch(sellerDatasourceProvider));
});

final sellerNotifierProvider =
    StateNotifierProvider<SellerNotifier, SellerState>((ref) {
  return SellerNotifier(ref.watch(sellerRepositoryProvider));
});

class SellerNotifier extends StateNotifier<SellerState> {
  final SellerRepository _repository;

  SellerNotifier(this._repository) : super(const SellerState.initial());

  Future<void> loadTags() async {
    state = const SellerState.loading();
    final result = await _repository.getSellerTags();
    state = result.fold(
      (failure) => SellerState.error(failure.message),
      (tags) => SellerState.loaded(tags),
    );
  }

  void reset() {
    state = const SellerState.initial();
  }
}

final sellerListingsProvider =
    FutureProvider<List<Map<String, dynamic>>>((ref) async {
  final repo = ref.watch(sellerRepositoryProvider);
  final result = await repo.getSellerListings();
  return result.fold(
    (failure) => throw Exception(failure.message),
    (listings) => listings,
  );
});

final registrationWizardProvider = StateNotifierProvider<
    RegistrationWizardNotifier, RegistrationWizardState>((ref) {
  return RegistrationWizardNotifier(
    ref.watch(sellerRepositoryProvider),
    ApiConstants.kUseMockNfc ? MockNfcService() : NfcServiceImpl(),
  );
});

class RegistrationWizardNotifier
    extends StateNotifier<RegistrationWizardState> {
  final SellerRepository _repository;
  final NfcService _nfcService;

  RegistrationWizardNotifier(this._repository, this._nfcService)
      : super(const RegistrationWizardState.selectListing());

  void selectListing(String listingId, String listingTitle) {
    state = RegistrationWizardState.scanTag(
      listingId: listingId,
      listingTitle: listingTitle,
    );
  }

  Future<void> scanTag(String listingId, String listingTitle) async {
    try {
      final scanData = await _nfcService.startSession();
      state = RegistrationWizardState.enterKey(
        listingId: listingId,
        listingTitle: listingTitle,
        tagUid: scanData.tagUid,
      );
    } catch (e) {
      state = RegistrationWizardState.error(e.toString());
    }
  }

  void enterAesKey({
    required String listingId,
    required String listingTitle,
    required String tagUid,
    required String aesKey,
  }) {
    state = RegistrationWizardState.confirming(
      listingId: listingId,
      listingTitle: listingTitle,
      tagUid: tagUid,
      aesKey: aesKey,
    );
  }

  Future<void> confirmRegistration({
    required String listingId,
    required String tagUid,
    required String aesKey,
  }) async {
    final result = await _repository.registerTag(
      tagUid: tagUid,
      aesKey: aesKey,
      itemId: listingId,
      tenantId: 'authentic-materials',
    );
    state = result.fold(
      (failure) => RegistrationWizardState.error(failure.message),
      (reg) => RegistrationWizardState.success(reg),
    );
  }

  void reset() {
    state = const RegistrationWizardState.selectListing();
  }

  void cancelNfc() {
    _nfcService.stopSession();
  }
}
