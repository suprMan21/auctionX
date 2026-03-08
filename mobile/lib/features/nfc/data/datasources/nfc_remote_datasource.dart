import '../../../../core/network/api_client.dart';
import '../../domain/entities/scan_result.dart';
import '../../domain/entities/tag_detail.dart';

class NfcRemoteDatasource {
  final ApiClient _client;

  NfcRemoteDatasource(this._client);

  Future<ScanResult> submitScan({
    required String tagUid,
    required String piccData,
    required String cmac,
  }) async {
    final response = await _client.post<Map<String, dynamic>>(
      '/nfc/scan',
      data: {
        'tagUid': tagUid,
        'piccData': piccData,
        'cmac': cmac,
      },
    );
    final data = response.data as Map<String, dynamic>;
    return ScanResult.fromJson(data['data'] as Map<String, dynamic>);
  }

  Future<TagDetail> getTagDetail(String tagId) async {
    final response = await _client.get<Map<String, dynamic>>('/nfc/$tagId');
    final data = response.data as Map<String, dynamic>;
    return TagDetail.fromJson(data['data'] as Map<String, dynamic>);
  }

  Future<TagDetail> getTagByUid(String tagUid) async {
    final response = await _client.get<Map<String, dynamic>>('/nfc/by-uid/$tagUid');
    final data = response.data as Map<String, dynamic>;
    return TagDetail.fromJson(data['data'] as Map<String, dynamic>);
  }
}
