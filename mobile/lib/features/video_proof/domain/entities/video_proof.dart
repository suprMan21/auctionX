import 'package:freezed_annotation/freezed_annotation.dart';

part 'video_proof.freezed.dart';
part 'video_proof.g.dart';

@freezed
abstract class VideoProof with _$VideoProof {
  const VideoProof._();

  const factory VideoProof({
    required String tagId,
    required String localPath,
    required int fileSizeBytes,
    required int durationMs,
    String? uploadUrl,
    String? publicUrl,
    String? videoKey,
    String? proofId,
  }) = _VideoProof;

  Duration get duration => Duration(milliseconds: durationMs);

  factory VideoProof.fromJson(Map<String, dynamic> json) =>
      _$VideoProofFromJson(json);
}
