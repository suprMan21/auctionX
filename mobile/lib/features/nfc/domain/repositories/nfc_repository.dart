import 'package:dartz/dartz.dart';
import '../../../../core/errors/failures.dart';
import '../entities/scan_result.dart';
import '../entities/tag_detail.dart';

abstract class NfcRepository {
  Future<Either<Failure, ScanResult>> submitScan({
    required String tagUid,
    required String piccData,
    required String cmac,
  });

  Future<Either<Failure, TagDetail>> getTagDetail(String tagId);

  Future<Either<Failure, TagDetail>> getTagByUid(String tagUid);
}
