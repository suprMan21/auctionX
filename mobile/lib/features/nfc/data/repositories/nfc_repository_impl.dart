import 'package:dartz/dartz.dart';
import 'package:dio/dio.dart';
import '../../../../core/errors/failures.dart';
import '../../../../core/network/api_client.dart';
import '../../domain/entities/pending_scan.dart';
import '../../domain/entities/scan_result.dart';
import '../../domain/entities/tag_detail.dart';
import '../../domain/repositories/nfc_repository.dart';
import '../datasources/nfc_local_datasource.dart';
import '../datasources/nfc_remote_datasource.dart';

class NfcRepositoryImpl implements NfcRepository {
  final NfcRemoteDatasource _remote;
  final NfcLocalDatasource _local;

  NfcRepositoryImpl(this._remote, this._local);

  @override
  Future<Either<Failure, ScanResult>> submitScan({
    required String tagUid,
    required String piccData,
    required String cmac,
  }) async {
    try {
      final result = await _remote.submitScan(
        tagUid: tagUid,
        piccData: piccData,
        cmac: cmac,
      );
      return Right(result);
    } on DioException catch (e) {
      final failure = ApiClient.mapError(e);
      if (failure is NetworkFailure) {
        // Save offline for later sync
        await _local.savePendingScan(PendingScan(
          tagUid: tagUid,
          piccData: piccData,
          cmac: cmac,
          scannedAt: DateTime.now(),
        ));
        return Left(NetworkFailure('Scan saved offline: ${failure.message}'));
      }
      return Left(failure);
    } catch (e) {
      return Left(ServerFailure(e.toString()));
    }
  }

  @override
  Future<Either<Failure, TagDetail>> getTagDetail(String tagId) async {
    try {
      final detail = await _remote.getTagDetail(tagId);
      return Right(detail);
    } on DioException catch (e) {
      return Left(ApiClient.mapError(e));
    } catch (e) {
      return Left(ServerFailure(e.toString()));
    }
  }

  @override
  Future<Either<Failure, TagDetail>> getTagByUid(String tagUid) async {
    try {
      final detail = await _remote.getTagByUid(tagUid);
      return Right(detail);
    } on DioException catch (e) {
      return Left(ApiClient.mapError(e));
    } catch (e) {
      return Left(ServerFailure(e.toString()));
    }
  }
}
