import 'package:dartz/dartz.dart';
import '../../../../core/errors/failures.dart';
import '../entities/upload_progress.dart';
import '../entities/video_proof.dart';

abstract class VideoProofRepository {
  Future<Either<Failure, VideoProof>> requestUploadUrl({
    required String tagId,
    required String contentType,
    required int fileSize,
  });

  Stream<Either<Failure, UploadProgress>> uploadVideo({
    required String uploadUrl,
    required String filePath,
    required String contentType,
  });

  Future<Either<Failure, void>> confirmUpload({
    required String proofId,
  });
}
