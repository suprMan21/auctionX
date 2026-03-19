import 'package:dartz/dartz.dart';
import 'package:dio/dio.dart';
import '../../../../core/errors/failures.dart';
import '../../../../core/network/api_client.dart';
import '../../domain/entities/upload_progress.dart';
import '../../domain/entities/video_proof.dart';
import '../../domain/repositories/video_proof_repository.dart';
import '../datasources/video_proof_remote_datasource.dart';

class VideoProofRepositoryImpl implements VideoProofRepository {
  final VideoProofRemoteDatasource _remote;

  VideoProofRepositoryImpl(this._remote);

  @override
  Future<Either<Failure, VideoProof>> requestUploadUrl({
    required String tagId,
    required String contentType,
    required int fileSize,
  }) async {
    try {
      final proof = await _remote.requestUploadUrl(
        tagId: tagId,
        contentType: contentType,
        fileSize: fileSize,
      );
      return Right(proof);
    } on DioException catch (e) {
      return Left(ApiClient.mapError(e));
    } catch (e) {
      return Left(ServerFailure(e.toString()));
    }
  }

  @override
  Stream<Either<Failure, UploadProgress>> uploadVideo({
    required String uploadUrl,
    required String filePath,
    required String contentType,
  }) async* {
    try {
      await for (final progress in _remote.uploadToS3(
        uploadUrl: uploadUrl,
        filePath: filePath,
        contentType: contentType,
      )) {
        yield Right(progress);
      }
    } on DioException catch (e) {
      yield Left(ApiClient.mapError(e));
    } catch (e) {
      yield Left(ServerFailure(e.toString()));
    }
  }

  @override
  Future<Either<Failure, void>> confirmUpload({
    required String proofId,
  }) async {
    try {
      await _remote.confirmUpload(proofId: proofId);
      return const Right(null);
    } on DioException catch (e) {
      return Left(ApiClient.mapError(e));
    } catch (e) {
      return Left(ServerFailure(e.toString()));
    }
  }
}
