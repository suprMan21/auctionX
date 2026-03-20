import '../../../../core/network/api_client.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class SellerRemoteDatasource {
  final ApiClient _apiClient;
  final SupabaseClient _supabase;

  SellerRemoteDatasource(this._apiClient, this._supabase);

  Future<List<Map<String, dynamic>>> getSellerTags() async {
    final response = await _apiClient.get<Map<String, dynamic>>('/nfc/tags');
    final data = response.data;
    if (data == null || data['success'] != true) {
      throw Exception(data?['error']?.toString() ?? 'Failed to fetch tags');
    }
    final list = data['data'] as List<dynamic>? ?? [];
    return list.cast<Map<String, dynamic>>();
  }

  Future<Map<String, dynamic>> registerTag({
    required String tagUid,
    required String aesKey,
    required String itemId,
    required String tenantId,
  }) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/nfc/register',
      data: {
        'tagUid': tagUid,
        'aesKey': aesKey,
        'itemId': itemId,
        'tenantId': tenantId,
      },
    );
    final data = response.data;
    if (data == null || data['success'] != true) {
      throw Exception(data?['error']?.toString() ?? 'Registration failed');
    }
    return (data['data'] as Map<String, dynamic>?) ?? {};
  }

  Future<List<Map<String, dynamic>>> getSellerListings() async {
    final userId = _supabase.auth.currentUser?.id;
    if (userId == null) throw Exception('Not authenticated');

    final response = await _supabase
        .from('listings')
        .select('id, title, status, created_at')
        .eq('seller_id', userId)
        .order('created_at', ascending: false);

    return List<Map<String, dynamic>>.from(response);
  }
}
