import 'package:dio/dio.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../constants/api_constants.dart';
import '../errors/failures.dart';

class ApiClient {
  late final Dio _dio;

  ApiClient() {
    _dio = Dio(
      BaseOptions(
        baseUrl: ApiConstants.apiBaseUrl,
        connectTimeout: ApiConstants.connectTimeout,
        receiveTimeout: ApiConstants.receiveTimeout,
        headers: {'Content-Type': 'application/json'},
      ),
    );

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          final session = Supabase.instance.client.auth.currentSession;
          if (session != null) {
            options.headers['Authorization'] = 'Bearer ${session.accessToken}';
          }
          handler.next(options);
        },
        onError: (error, handler) {
          handler.next(error);
        },
      ),
    );
  }

  Future<Response<T>> get<T>(
    String path, {
    Map<String, dynamic>? queryParameters,
  }) => _dio.get(path, queryParameters: queryParameters);

  Future<Response<T>> post<T>(
    String path, {
    Object? data,
  }) => _dio.post(path, data: data);

  Future<Response<T>> put<T>(
    String path, {
    Object? data,
  }) => _dio.put(path, data: data);

  Future<Response<T>> delete<T>(String path) => _dio.delete(path);

  static Failure mapError(DioException e) {
    return switch (e.type) {
      DioExceptionType.connectionTimeout ||
      DioExceptionType.receiveTimeout ||
      DioExceptionType.sendTimeout => const NetworkFailure('Request timed out'),
      DioExceptionType.connectionError => const NetworkFailure(),
      DioExceptionType.badResponse => ServerFailure(
          e.response?.data?['error']?.toString() ?? 'Server error',
          statusCode: e.response?.statusCode,
        ),
      _ => ServerFailure(e.message ?? 'Unknown error'),
    };
  }
}
