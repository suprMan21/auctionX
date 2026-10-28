import 'package:supabase_flutter/supabase_flutter.dart';

import '../../../core/network/api_client.dart';

/// `users.account_type`, set only by a database trigger (Collector by default,
/// Creator after the identity check or a staff override).
enum AccountType { collector, creator }

abstract class AccountTypeReader {
  Future<AccountType> read(String userId);
}

/// Reads the signed-in person's own `users` row (row-level security allows
/// only that row) and only the `account_type` column.
class SupabaseAccountTypeReader implements AccountTypeReader {
  SupabaseAccountTypeReader(this._client);

  final SupabaseClient _client;

  @override
  Future<AccountType> read(String userId) async {
    try {
      final row = await _client.from('users').select('account_type').eq('id', userId).maybeSingle();
      return row?['account_type'] == 'creator' ? AccountType.creator : AccountType.collector;
    } on PostgrestException catch (e) {
      final status = int.tryParse(e.code ?? '');
      throw ApiException(
        message: 'We couldn’t load your account. Please try again.',
        status: status != null && status >= 400 && status < 600 ? status : 500,
        code: 'account_type_unavailable',
      );
    } on AuthException {
      throw const ApiException(message: 'Please sign in again.', status: 401, code: 'unauthenticated');
    } catch (_) {
      throw const ApiException(
          message: "Can't reach Authentic Materials. Check your connection and try again.");
    }
  }
}
