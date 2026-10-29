import '../../../core/network/api_client.dart';
import '../../mfa/data/mfa_api.dart';
import 'pending_seal.dart';

class SealSession {
  const SealSession({required this.id, required this.startedAt});
  final String id;
  final DateTime startedAt;
}

class SealCommitted {
  const SealCommitted({required this.sealId, required this.tagId});
  final String sealId;
  final String tagId;
}

/// `/api/v1/nfc/seal` (backend `controllers/sealController.ts`).
class SealApi {
  const SealApi(this._api);

  final ApiClient _api;

  /// Optional, online at tap 1: gives the record a server time. Never says whether the serial is a chip.
  Future<SealSession> startSession(String serial) async {
    final data = await _api.post('/nfc/seal/session', body: {'serial': serial});
    final id = data['sessionId'];
    final at = data['startedAt'];
    if (id is! String || at is! String) {
      throw const ApiException(message: 'Unexpected response from the server.', code: 'bad_response');
    }
    return SealSession(id: id, startedAt: DateTime.parse(at));
  }

  /// The commit. [stepUpToken] is a `seal` grant bound to the chip serial.
  Future<SealCommitted> commit(PendingSeal seal, String stepUpToken) async {
    final data = await _api.post(
      '/nfc/seal',
      body: seal.commitBody(),
      headers: {MfaApi.stepUpHeader: stepUpToken},
    );
    final sealId = data['sealId'];
    final tagId = data['tagId'];
    if (sealId is! String || tagId is! String) {
      throw const ApiException(message: 'Unexpected response from the server.', code: 'bad_response');
    }
    return SealCommitted(sealId: sealId, tagId: tagId);
  }
}
