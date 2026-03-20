import 'dart:async';
import 'dart:io';
import 'package:dio/dio.dart';
import '../../../../core/network/api_client.dart';
import '../../domain/entities/upload_progress.dart';
import '../../domain/entities/video_proof.dart';

class VideoProofRemoteDatasource {
  final ApiClient _client;

  VideoProofRemoteDatasource(this._client);

  Future<VideoProof> requestUploadUrl({
    required String tagId,
    required String contentType,
    required int fileSize,
  }) async {
    final response = await _client.post<Map<String, dynamic>>(
      '/nfc/proof',
      data: {
        'tagId': tagId,
        'contentType': contentType,
        'fileSize': fileSize,
      },
    );
    final data = response.data as Map<String, dynamic>;
    final proofData = data['data'] as Map<String, dynamic>;

    return VideoProof(
      tagId: tagId,
      localPath: '',
      fileSizeBytes: fileSize,
      durationMs: 0,
      uploadUrl: proofData['uploadUrl'] as String,
      publicUrl: proofData['publicUrl'] as String,
      videoKey: proofData['videoKey'] as String,
    );
  }

  Stream<UploadProgress> uploadToS3({
    required String uploadUrl,
    required String filePath,
    required String contentType,
    CancelToken? cancelToken,
  }) async* {
    final file = File(filePath);
    final fileSize = await file.length();

    // Use a raw Dio instance — presigned URLs include their own auth
    final dio = Dio();

    final controller = StreamController<UploadProgress>();

    dio.put<void>(
      uploadUrl,
      data: file.openRead(),
      options: Options(
        contentType: contentType,
        headers: {
          Headers.contentLengthHeader: fileSize,
        },
      ),
      cancelToken: cancelToken,
      onSendProgress: (sent, total) {
        controller.add(UploadProgress(
          bytesSent: sent,
          totalBytes: total,
        ));
      },
    ).then((_) {
      controller.close();
    }).catchError((Object e) {
      controller.addError(e);
      controller.close();
    });

    yield* controller.stream;
  }
}
