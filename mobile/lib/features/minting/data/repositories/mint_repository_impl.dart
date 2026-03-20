import 'package:dartz/dartz.dart';
import 'package:dio/dio.dart';
import '../../../../core/errors/failures.dart';
import '../../../../core/network/api_client.dart';
import '../../domain/entities/mint_result.dart';
import '../../domain/repositories/mint_repository.dart';
import '../datasources/mint_remote_datasource.dart';

class MintRepositoryImpl implements MintRepository {
  final MintRemoteDatasource _remote;

  MintRepositoryImpl(this._remote);

  @override
  Future<Either<Failure, MintResult>> mintVerification({
    required String tagId,
  }) async {
    try {
      final result = await _remote.mintVerification(tagId: tagId);
      return Right(result);
    } on DioException catch (e) {
      return Left(ApiClient.mapError(e));
    } catch (e) {
      return Left(ServerFailure(e.toString()));
    }
  }
}
