import 'package:dartz/dartz.dart';
import 'package:dio/dio.dart';
import '../../../../core/errors/failures.dart';
import '../../../../core/network/api_client.dart';
import '../../domain/entities/registration_result.dart';
import '../../domain/entities/seller_tag.dart';
import '../../domain/repositories/seller_repository.dart';
import '../datasources/seller_remote_datasource.dart';

class SellerRepositoryImpl implements SellerRepository {
  final SellerRemoteDatasource _datasource;

  SellerRepositoryImpl(this._datasource);

  @override
  Future<Either<Failure, List<SellerTag>>> getSellerTags() async {
    try {
      final data = await _datasource.getSellerTags();
      final tags = data.map((json) => SellerTag.fromJson(json)).toList();
      return Right(tags);
    } on DioException catch (e) {
      return Left(ApiClient.mapError(e));
    } catch (e) {
      return Left(ServerFailure(e.toString()));
    }
  }

  @override
  Future<Either<Failure, RegistrationResult>> registerTag({
    required String tagUid,
    required String aesKey,
    required String itemId,
    required String tenantId,
  }) async {
    try {
      final data = await _datasource.registerTag(
        tagUid: tagUid,
        aesKey: aesKey,
        itemId: itemId,
        tenantId: tenantId,
      );
      return Right(RegistrationResult.fromJson(data));
    } on DioException catch (e) {
      return Left(ApiClient.mapError(e));
    } catch (e) {
      return Left(ServerFailure(e.toString()));
    }
  }

  @override
  Future<Either<Failure, List<Map<String, dynamic>>>> getSellerListings() async {
    try {
      final data = await _datasource.getSellerListings();
      return Right(data);
    } on DioException catch (e) {
      return Left(ApiClient.mapError(e));
    } catch (e) {
      return Left(ServerFailure(e.toString()));
    }
  }
}
