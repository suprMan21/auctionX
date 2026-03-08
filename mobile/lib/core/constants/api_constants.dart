class ApiConstants {
  ApiConstants._();

  static const supabaseUrl = 'https://pmlofthmobglcfkqjtru.supabase.co';
  static const supabaseAnonKey = 'sb_publishable_QOUABgX8WDKnr_kJdSSmXfXbSPq9FvFRRLVQnRbUQBPAPkqLxUDaDn_S3T5qbGKjmN8axvREVrnpaJUvJgJHlVE';
  static const apiBaseUrl = 'https://vw7zy9mkyg.us-east-2.awsapprunner.com/api/v1';
  static const connectTimeout = Duration(seconds: 15);
  static const receiveTimeout = Duration(seconds: 15);

  /// Set to false for physical NFC tag testing
  static const bool kUseMockNfc = true;
}
