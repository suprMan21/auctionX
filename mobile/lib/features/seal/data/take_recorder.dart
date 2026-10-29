import 'package:camera/camera.dart';
import 'package:flutter/widgets.dart';

enum RecorderFailure { noCamera, denied, failed }

class RecorderException implements Exception {
  const RecorderException(this.failure, [this.detail]);
  final RecorderFailure failure;
  final String? detail;
  @override
  String toString() => 'RecorderException($failure, $detail)';
}

/// The camera, behind our own interface (tests use a fake). Live capture only: no gallery, no pause.
abstract class TakeRecorder {
  Future<void> init();
  Widget preview();
  bool get canFlip;
  Future<void> flip();
  Future<void> start();

  /// Stops and returns the file path.
  Future<String> stop();
  Future<void> dispose();
}

class CameraTakeRecorder implements TakeRecorder {
  List<CameraDescription> _cameras = const [];
  CameraController? _controller;

  // Front camera first: the creator talks to the camera, then shows the piece.
  CameraLensDirection _lens = CameraLensDirection.front;

  @override
  Future<void> init() async {
    try {
      _cameras = await availableCameras();
    } on CameraException catch (e) {
      throw RecorderException(_failureOf(e), e.code);
    }
    if (_cameras.isEmpty) throw const RecorderException(RecorderFailure.noCamera);
    await _open();
  }

  CameraDescription get _camera =>
      _cameras.firstWhere((c) => c.lensDirection == _lens, orElse: () => _cameras.first);

  Future<void> _open() async {
    final old = _controller;
    _controller = null;
    await old?.dispose();
    final controller = CameraController(
      _camera,
      // 1080p: a 2-minute take stays near 200 MB.
      ResolutionPreset.veryHigh,
      enableAudio: true,
    );
    try {
      await controller.initialize();
    } on CameraException catch (e) {
      await controller.dispose();
      throw RecorderException(_failureOf(e), e.code);
    }
    _controller = controller;
  }

  static RecorderFailure _failureOf(CameraException e) =>
      e.code.contains('AccessDenied') || e.code.contains('Restricted') ? RecorderFailure.denied : RecorderFailure.failed;

  @override
  Widget preview() {
    final c = _controller;
    if (c == null || !c.value.isInitialized) return const SizedBox.expand();
    return CameraPreview(c);
  }

  @override
  bool get canFlip => _cameras.map((c) => c.lensDirection).toSet().length > 1;

  @override
  Future<void> flip() async {
    _lens = _lens == CameraLensDirection.front ? CameraLensDirection.back : CameraLensDirection.front;
    await _open();
  }

  @override
  Future<void> start() async {
    final c = _controller;
    if (c == null) throw const RecorderException(RecorderFailure.failed, 'not ready');
    try {
      await c.startVideoRecording();
    } on CameraException catch (e) {
      throw RecorderException(RecorderFailure.failed, e.code);
    }
  }

  @override
  Future<String> stop() async {
    final c = _controller;
    if (c == null) throw const RecorderException(RecorderFailure.failed, 'not ready');
    try {
      return (await c.stopVideoRecording()).path;
    } on CameraException catch (e) {
      throw RecorderException(RecorderFailure.failed, e.code);
    }
  }

  @override
  Future<void> dispose() async {
    final c = _controller;
    _controller = null;
    await c?.dispose();
  }
}
