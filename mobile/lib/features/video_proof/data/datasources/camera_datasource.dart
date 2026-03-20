import 'package:camera/camera.dart';

class CameraDatasource {
  CameraController? _controller;

  CameraController? get controller => _controller;

  Future<CameraController> initialize() async {
    final cameras = await availableCameras();
    if (cameras.isEmpty) {
      throw CameraException('noCameras', 'No cameras available on this device');
    }

    // Prefer rear camera
    final camera = cameras.firstWhere(
      (c) => c.lensDirection == CameraLensDirection.back,
      orElse: () => cameras.first,
    );

    _controller = CameraController(
      camera,
      ResolutionPreset.high,
      enableAudio: true,
    );

    await _controller!.initialize();
    return _controller!;
  }

  Future<XFile> stopRecording() async {
    if (_controller == null || !_controller!.value.isRecordingVideo) {
      throw CameraException('notRecording', 'Camera is not recording');
    }
    return _controller!.stopVideoRecording();
  }

  Future<void> startRecording() async {
    if (_controller == null || !_controller!.value.isInitialized) {
      throw CameraException('notInitialized', 'Camera is not initialized');
    }
    await _controller!.startVideoRecording();
  }

  Future<void> dispose() async {
    await _controller?.dispose();
    _controller = null;
  }
}
