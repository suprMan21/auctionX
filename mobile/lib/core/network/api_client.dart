import 'package:dio/dio.dart';

/// What the app tells the backend about itself on every request.
class ClientInfo {
  const ClientInfo({required this.version, required this.build, required this.platform});

  /// `x.y.z`, compared with the server's minimum version.
  final String version;
  final String build;

  /// `ios` or `android`.
  final String platform;

  /// Shown in security emails ("New sign-in from …") instead of `Dart/3.x`.
  String get userAgent =>
      'AuthenticMaterials/$version ($build; ${platform == 'ios' ? 'iOS' : 'Android'})';
}

/// A refused or failed request, in the backend's house envelope terms.
/// Screens branch on [reason] (a closed set the server defines), never on text.
class ApiException implements Exception {
  const ApiException({
    required this.message,
    this.status,
    this.code,
    this.reason,
    this.retryAfter,
  });

  final String message;
  final int? status;
  final String? code;
  final String? reason;
  final Duration? retryAfter;

  bool get isNetwork => status == null;
  bool get updateRequired => reason == appUpdateRequired;

  static const appUpdateRequired = 'app_update_required';

  /// Builds the exception from a Dio failure, reading `{ success, error, code,
  /// reason, details: { reason } }` when the server sent one.
  factory ApiException.fromDio(DioException e) {
    final res = e.response;
    if (res == null) {
      return ApiException(
        message: e.type == DioExceptionType.connectionTimeout ||
                e.type == DioExceptionType.receiveTimeout ||
                e.type == DioExceptionType.sendTimeout
            ? 'The connection timed out. Check your signal and try again.'
            : "Can't reach Authentic Materials. Check your connection and try again.",
      );
    }
    final body = res.data;
    String? str(Object? v) => v is String && v.isNotEmpty ? v : null;
    String? message;
    String? code;
    String? reason;
    if (body is Map) {
      message = str(body['error']);
      code = str(body['code']);
      reason = str(body['reason']);
      final details = body['details'];
      if (reason == null && details is Map) reason = str(details['reason']);
    }
    final retry = int.tryParse(res.headers.value('retry-after') ?? '');
    return ApiException(
      // Server text is only shown for 4xx; 5xx gets a plain message.
      message: (res.statusCode ?? 500) < 500 && message != null
          ? message
          : 'Something went wrong on our side. Please try again.',
      status: res.statusCode,
      code: code,
      reason: reason,
      retryAfter: retry != null ? Duration(seconds: retry) : null,
    );
  }

  @override
  String toString() => 'ApiException($status, $reason): $message';
}

typedef TokenProvider = String? Function();

/// Thin Dio wrapper: auth header, app identity headers, envelope unwrapping.
class ApiClient {
  ApiClient({
    required String baseUrl,
    required ClientInfo client,
    required TokenProvider accessToken,
    void Function()? onUpdateRequired,
    Dio? dio,
  }) : _dio = dio ?? Dio() {
    _dio.options
      ..baseUrl = baseUrl
      ..connectTimeout = const Duration(seconds: 15)
      ..receiveTimeout = const Duration(seconds: 20)
      ..headers.addAll({
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-App-Version': client.version,
        'X-App-Platform': client.platform,
        'User-Agent': client.userAgent,
      });
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) {
        final token = accessToken();
        if (token != null) options.headers['Authorization'] = 'Bearer $token';
        handler.next(options);
      },
      onError: (error, handler) {
        final ex = ApiException.fromDio(error);
        if (ex.updateRequired) onUpdateRequired?.call();
        handler.next(error);
      },
    ));
  }

  final Dio _dio;

  /// GET returning the envelope's `data` (a JSON object).
  Future<Map<String, dynamic>> get(String path, {Map<String, String>? headers}) =>
      _send(() => _dio.get<Object?>(path, options: Options(headers: headers)));

  /// POST returning the envelope's `data` (a JSON object).
  Future<Map<String, dynamic>> post(String path, {Object? body, Map<String, String>? headers}) =>
      _send(() => _dio.post<Object?>(path, data: body ?? const {}, options: Options(headers: headers)));

  Future<Map<String, dynamic>> patch(String path, {Object? body, Map<String, String>? headers}) =>
      _send(() => _dio.patch<Object?>(path, data: body ?? const {}, options: Options(headers: headers)));

  Future<Map<String, dynamic>> delete(String path, {Map<String, String>? headers}) =>
      _send(() => _dio.delete<Object?>(path, options: Options(headers: headers)));

  Future<Map<String, dynamic>> _send(Future<Response<Object?>> Function() call) async {
    try {
      final res = await call();
      return unwrap(res.data);
    } on DioException catch (e) {
      throw ApiException.fromDio(e);
    }
  }

  /// `{ success: true, data: {...} }` → the data map. Anything else is an error.
  static Map<String, dynamic> unwrap(Object? body) {
    if (body is Map && body['success'] == true) {
      final data = body['data'];
      if (data is Map<String, dynamic>) return data;
      if (data == null) return const {};
    }
    throw const ApiException(message: 'Unexpected response from the server.', code: 'bad_response');
  }
}
