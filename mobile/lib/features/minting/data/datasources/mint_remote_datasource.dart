import '../../../../core/network/api_client.dart';
import '../../domain/entities/mint_result.dart';

class MintRemoteDatasource {
  final ApiClient _client;

  MintRemoteDatasource(this._client);

  Future<MintResult> mintVerification({required String tagId}) async {
    final response = await _client.post<Map<String, dynamic>>(
      '/nfc/mint',
      data: {'tagId': tagId},
    );
    final data = response.data as Map<String, dynamic>;
    final resultData = data['data'] as Map<String, dynamic>;
    return MintResult(
      tokenId: resultData['tokenId']?.toString() ?? '',
      txHash: resultData['txHash']?.toString() ?? '',
      metadataUri: resultData['metadataUri']?.toString() ?? '',
      blockExplorerUrl: resultData['blockExplorerUrl']?.toString() ?? '',
      chain: resultData['chain']?.toString() ?? 'base-sepolia',
      contractAddress: resultData['contractAddress']?.toString() ?? '',
    );
  }
}
