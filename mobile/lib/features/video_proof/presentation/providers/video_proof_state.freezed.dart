// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'video_proof_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;
/// @nodoc
mixin _$VideoProofState {





@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is VideoProofState);
}


@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
  return 'VideoProofState()';
}


}

/// @nodoc
class $VideoProofStateCopyWith<$Res>  {
$VideoProofStateCopyWith(VideoProofState _, $Res Function(VideoProofState) __);
}


/// Adds pattern-matching-related methods to [VideoProofState].
extension VideoProofStatePatterns on VideoProofState {
/// A variant of `map` that fallback to returning `orElse`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeMap<TResult extends Object?>({TResult Function( VideoProofIdle value)?  idle,TResult Function( VideoProofInitializing value)?  initializing,TResult Function( VideoProofReady value)?  ready,TResult Function( VideoProofRecording value)?  recording,TResult Function( VideoProofStopped value)?  stopped,TResult Function( VideoProofBurning value)?  burning,TResult Function( VideoProofCompressing value)?  compressing,TResult Function( VideoProofCompressed value)?  compressed,TResult Function( VideoProofUploading value)?  uploading,TResult Function( VideoProofComplete value)?  complete,TResult Function( VideoProofError value)?  error,TResult Function( VideoProofPermissionDenied value)?  permissionDenied,required TResult orElse(),}){
final _that = this;
switch (_that) {
case VideoProofIdle() when idle != null:
return idle(_that);case VideoProofInitializing() when initializing != null:
return initializing(_that);case VideoProofReady() when ready != null:
return ready(_that);case VideoProofRecording() when recording != null:
return recording(_that);case VideoProofStopped() when stopped != null:
return stopped(_that);case VideoProofBurning() when burning != null:
return burning(_that);case VideoProofCompressing() when compressing != null:
return compressing(_that);case VideoProofCompressed() when compressed != null:
return compressed(_that);case VideoProofUploading() when uploading != null:
return uploading(_that);case VideoProofComplete() when complete != null:
return complete(_that);case VideoProofError() when error != null:
return error(_that);case VideoProofPermissionDenied() when permissionDenied != null:
return permissionDenied(_that);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// Callbacks receives the raw object, upcasted.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case final Subclass2 value:
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult map<TResult extends Object?>({required TResult Function( VideoProofIdle value)  idle,required TResult Function( VideoProofInitializing value)  initializing,required TResult Function( VideoProofReady value)  ready,required TResult Function( VideoProofRecording value)  recording,required TResult Function( VideoProofStopped value)  stopped,required TResult Function( VideoProofBurning value)  burning,required TResult Function( VideoProofCompressing value)  compressing,required TResult Function( VideoProofCompressed value)  compressed,required TResult Function( VideoProofUploading value)  uploading,required TResult Function( VideoProofComplete value)  complete,required TResult Function( VideoProofError value)  error,required TResult Function( VideoProofPermissionDenied value)  permissionDenied,}){
final _that = this;
switch (_that) {
case VideoProofIdle():
return idle(_that);case VideoProofInitializing():
return initializing(_that);case VideoProofReady():
return ready(_that);case VideoProofRecording():
return recording(_that);case VideoProofStopped():
return stopped(_that);case VideoProofBurning():
return burning(_that);case VideoProofCompressing():
return compressing(_that);case VideoProofCompressed():
return compressed(_that);case VideoProofUploading():
return uploading(_that);case VideoProofComplete():
return complete(_that);case VideoProofError():
return error(_that);case VideoProofPermissionDenied():
return permissionDenied(_that);}
}
/// A variant of `map` that fallback to returning `null`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>({TResult? Function( VideoProofIdle value)?  idle,TResult? Function( VideoProofInitializing value)?  initializing,TResult? Function( VideoProofReady value)?  ready,TResult? Function( VideoProofRecording value)?  recording,TResult? Function( VideoProofStopped value)?  stopped,TResult? Function( VideoProofBurning value)?  burning,TResult? Function( VideoProofCompressing value)?  compressing,TResult? Function( VideoProofCompressed value)?  compressed,TResult? Function( VideoProofUploading value)?  uploading,TResult? Function( VideoProofComplete value)?  complete,TResult? Function( VideoProofError value)?  error,TResult? Function( VideoProofPermissionDenied value)?  permissionDenied,}){
final _that = this;
switch (_that) {
case VideoProofIdle() when idle != null:
return idle(_that);case VideoProofInitializing() when initializing != null:
return initializing(_that);case VideoProofReady() when ready != null:
return ready(_that);case VideoProofRecording() when recording != null:
return recording(_that);case VideoProofStopped() when stopped != null:
return stopped(_that);case VideoProofBurning() when burning != null:
return burning(_that);case VideoProofCompressing() when compressing != null:
return compressing(_that);case VideoProofCompressed() when compressed != null:
return compressed(_that);case VideoProofUploading() when uploading != null:
return uploading(_that);case VideoProofComplete() when complete != null:
return complete(_that);case VideoProofError() when error != null:
return error(_that);case VideoProofPermissionDenied() when permissionDenied != null:
return permissionDenied(_that);case _:
  return null;

}
}
/// A variant of `when` that fallback to an `orElse` callback.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>({TResult Function()?  idle,TResult Function()?  initializing,TResult Function( CameraController controller)?  ready,TResult Function( CameraController controller,  int elapsedSeconds)?  recording,TResult Function( String filePath,  int durationSeconds)?  stopped,TResult Function( double progress)?  burning,TResult Function( double progress)?  compressing,TResult Function( String filePath,  int fileSize,  int durationSeconds)?  compressed,TResult Function( UploadProgress progress)?  uploading,TResult Function( String publicUrl)?  complete,TResult Function( String message)?  error,TResult Function()?  permissionDenied,required TResult orElse(),}) {final _that = this;
switch (_that) {
case VideoProofIdle() when idle != null:
return idle();case VideoProofInitializing() when initializing != null:
return initializing();case VideoProofReady() when ready != null:
return ready(_that.controller);case VideoProofRecording() when recording != null:
return recording(_that.controller,_that.elapsedSeconds);case VideoProofStopped() when stopped != null:
return stopped(_that.filePath,_that.durationSeconds);case VideoProofBurning() when burning != null:
return burning(_that.progress);case VideoProofCompressing() when compressing != null:
return compressing(_that.progress);case VideoProofCompressed() when compressed != null:
return compressed(_that.filePath,_that.fileSize,_that.durationSeconds);case VideoProofUploading() when uploading != null:
return uploading(_that.progress);case VideoProofComplete() when complete != null:
return complete(_that.publicUrl);case VideoProofError() when error != null:
return error(_that.message);case VideoProofPermissionDenied() when permissionDenied != null:
return permissionDenied();case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// As opposed to `map`, this offers destructuring.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case Subclass2(:final field2):
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult when<TResult extends Object?>({required TResult Function()  idle,required TResult Function()  initializing,required TResult Function( CameraController controller)  ready,required TResult Function( CameraController controller,  int elapsedSeconds)  recording,required TResult Function( String filePath,  int durationSeconds)  stopped,required TResult Function( double progress)  burning,required TResult Function( double progress)  compressing,required TResult Function( String filePath,  int fileSize,  int durationSeconds)  compressed,required TResult Function( UploadProgress progress)  uploading,required TResult Function( String publicUrl)  complete,required TResult Function( String message)  error,required TResult Function()  permissionDenied,}) {final _that = this;
switch (_that) {
case VideoProofIdle():
return idle();case VideoProofInitializing():
return initializing();case VideoProofReady():
return ready(_that.controller);case VideoProofRecording():
return recording(_that.controller,_that.elapsedSeconds);case VideoProofStopped():
return stopped(_that.filePath,_that.durationSeconds);case VideoProofBurning():
return burning(_that.progress);case VideoProofCompressing():
return compressing(_that.progress);case VideoProofCompressed():
return compressed(_that.filePath,_that.fileSize,_that.durationSeconds);case VideoProofUploading():
return uploading(_that.progress);case VideoProofComplete():
return complete(_that.publicUrl);case VideoProofError():
return error(_that.message);case VideoProofPermissionDenied():
return permissionDenied();}
}
/// A variant of `when` that fallback to returning `null`
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>({TResult? Function()?  idle,TResult? Function()?  initializing,TResult? Function( CameraController controller)?  ready,TResult? Function( CameraController controller,  int elapsedSeconds)?  recording,TResult? Function( String filePath,  int durationSeconds)?  stopped,TResult? Function( double progress)?  burning,TResult? Function( double progress)?  compressing,TResult? Function( String filePath,  int fileSize,  int durationSeconds)?  compressed,TResult? Function( UploadProgress progress)?  uploading,TResult? Function( String publicUrl)?  complete,TResult? Function( String message)?  error,TResult? Function()?  permissionDenied,}) {final _that = this;
switch (_that) {
case VideoProofIdle() when idle != null:
return idle();case VideoProofInitializing() when initializing != null:
return initializing();case VideoProofReady() when ready != null:
return ready(_that.controller);case VideoProofRecording() when recording != null:
return recording(_that.controller,_that.elapsedSeconds);case VideoProofStopped() when stopped != null:
return stopped(_that.filePath,_that.durationSeconds);case VideoProofBurning() when burning != null:
return burning(_that.progress);case VideoProofCompressing() when compressing != null:
return compressing(_that.progress);case VideoProofCompressed() when compressed != null:
return compressed(_that.filePath,_that.fileSize,_that.durationSeconds);case VideoProofUploading() when uploading != null:
return uploading(_that.progress);case VideoProofComplete() when complete != null:
return complete(_that.publicUrl);case VideoProofError() when error != null:
return error(_that.message);case VideoProofPermissionDenied() when permissionDenied != null:
return permissionDenied();case _:
  return null;

}
}

}

/// @nodoc


class VideoProofIdle implements VideoProofState {
  const VideoProofIdle();
  






@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is VideoProofIdle);
}


@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
  return 'VideoProofState.idle()';
}


}




/// @nodoc


class VideoProofInitializing implements VideoProofState {
  const VideoProofInitializing();
  






@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is VideoProofInitializing);
}


@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
  return 'VideoProofState.initializing()';
}


}




/// @nodoc


class VideoProofReady implements VideoProofState {
  const VideoProofReady(this.controller);
  

 final  CameraController controller;

/// Create a copy of VideoProofState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$VideoProofReadyCopyWith<VideoProofReady> get copyWith => _$VideoProofReadyCopyWithImpl<VideoProofReady>(this, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is VideoProofReady&&(identical(other.controller, controller) || other.controller == controller));
}


@override
int get hashCode => Object.hash(runtimeType,controller);

@override
String toString() {
  return 'VideoProofState.ready(controller: $controller)';
}


}

/// @nodoc
abstract mixin class $VideoProofReadyCopyWith<$Res> implements $VideoProofStateCopyWith<$Res> {
  factory $VideoProofReadyCopyWith(VideoProofReady value, $Res Function(VideoProofReady) _then) = _$VideoProofReadyCopyWithImpl;
@useResult
$Res call({
 CameraController controller
});




}
/// @nodoc
class _$VideoProofReadyCopyWithImpl<$Res>
    implements $VideoProofReadyCopyWith<$Res> {
  _$VideoProofReadyCopyWithImpl(this._self, this._then);

  final VideoProofReady _self;
  final $Res Function(VideoProofReady) _then;

/// Create a copy of VideoProofState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? controller = null,}) {
  return _then(VideoProofReady(
null == controller ? _self.controller : controller // ignore: cast_nullable_to_non_nullable
as CameraController,
  ));
}


}

/// @nodoc


class VideoProofRecording implements VideoProofState {
  const VideoProofRecording(this.controller, this.elapsedSeconds);
  

 final  CameraController controller;
 final  int elapsedSeconds;

/// Create a copy of VideoProofState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$VideoProofRecordingCopyWith<VideoProofRecording> get copyWith => _$VideoProofRecordingCopyWithImpl<VideoProofRecording>(this, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is VideoProofRecording&&(identical(other.controller, controller) || other.controller == controller)&&(identical(other.elapsedSeconds, elapsedSeconds) || other.elapsedSeconds == elapsedSeconds));
}


@override
int get hashCode => Object.hash(runtimeType,controller,elapsedSeconds);

@override
String toString() {
  return 'VideoProofState.recording(controller: $controller, elapsedSeconds: $elapsedSeconds)';
}


}

/// @nodoc
abstract mixin class $VideoProofRecordingCopyWith<$Res> implements $VideoProofStateCopyWith<$Res> {
  factory $VideoProofRecordingCopyWith(VideoProofRecording value, $Res Function(VideoProofRecording) _then) = _$VideoProofRecordingCopyWithImpl;
@useResult
$Res call({
 CameraController controller, int elapsedSeconds
});




}
/// @nodoc
class _$VideoProofRecordingCopyWithImpl<$Res>
    implements $VideoProofRecordingCopyWith<$Res> {
  _$VideoProofRecordingCopyWithImpl(this._self, this._then);

  final VideoProofRecording _self;
  final $Res Function(VideoProofRecording) _then;

/// Create a copy of VideoProofState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? controller = null,Object? elapsedSeconds = null,}) {
  return _then(VideoProofRecording(
null == controller ? _self.controller : controller // ignore: cast_nullable_to_non_nullable
as CameraController,null == elapsedSeconds ? _self.elapsedSeconds : elapsedSeconds // ignore: cast_nullable_to_non_nullable
as int,
  ));
}


}

/// @nodoc


class VideoProofStopped implements VideoProofState {
  const VideoProofStopped(this.filePath, this.durationSeconds);
  

 final  String filePath;
 final  int durationSeconds;

/// Create a copy of VideoProofState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$VideoProofStoppedCopyWith<VideoProofStopped> get copyWith => _$VideoProofStoppedCopyWithImpl<VideoProofStopped>(this, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is VideoProofStopped&&(identical(other.filePath, filePath) || other.filePath == filePath)&&(identical(other.durationSeconds, durationSeconds) || other.durationSeconds == durationSeconds));
}


@override
int get hashCode => Object.hash(runtimeType,filePath,durationSeconds);

@override
String toString() {
  return 'VideoProofState.stopped(filePath: $filePath, durationSeconds: $durationSeconds)';
}


}

/// @nodoc
abstract mixin class $VideoProofStoppedCopyWith<$Res> implements $VideoProofStateCopyWith<$Res> {
  factory $VideoProofStoppedCopyWith(VideoProofStopped value, $Res Function(VideoProofStopped) _then) = _$VideoProofStoppedCopyWithImpl;
@useResult
$Res call({
 String filePath, int durationSeconds
});




}
/// @nodoc
class _$VideoProofStoppedCopyWithImpl<$Res>
    implements $VideoProofStoppedCopyWith<$Res> {
  _$VideoProofStoppedCopyWithImpl(this._self, this._then);

  final VideoProofStopped _self;
  final $Res Function(VideoProofStopped) _then;

/// Create a copy of VideoProofState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? filePath = null,Object? durationSeconds = null,}) {
  return _then(VideoProofStopped(
null == filePath ? _self.filePath : filePath // ignore: cast_nullable_to_non_nullable
as String,null == durationSeconds ? _self.durationSeconds : durationSeconds // ignore: cast_nullable_to_non_nullable
as int,
  ));
}


}

/// @nodoc


class VideoProofBurning implements VideoProofState {
  const VideoProofBurning(this.progress);
  

 final  double progress;

/// Create a copy of VideoProofState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$VideoProofBurningCopyWith<VideoProofBurning> get copyWith => _$VideoProofBurningCopyWithImpl<VideoProofBurning>(this, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is VideoProofBurning&&(identical(other.progress, progress) || other.progress == progress));
}


@override
int get hashCode => Object.hash(runtimeType,progress);

@override
String toString() {
  return 'VideoProofState.burning(progress: $progress)';
}


}

/// @nodoc
abstract mixin class $VideoProofBurningCopyWith<$Res> implements $VideoProofStateCopyWith<$Res> {
  factory $VideoProofBurningCopyWith(VideoProofBurning value, $Res Function(VideoProofBurning) _then) = _$VideoProofBurningCopyWithImpl;
@useResult
$Res call({
 double progress
});




}
/// @nodoc
class _$VideoProofBurningCopyWithImpl<$Res>
    implements $VideoProofBurningCopyWith<$Res> {
  _$VideoProofBurningCopyWithImpl(this._self, this._then);

  final VideoProofBurning _self;
  final $Res Function(VideoProofBurning) _then;

/// Create a copy of VideoProofState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? progress = null,}) {
  return _then(VideoProofBurning(
null == progress ? _self.progress : progress // ignore: cast_nullable_to_non_nullable
as double,
  ));
}


}

/// @nodoc


class VideoProofCompressing implements VideoProofState {
  const VideoProofCompressing(this.progress);
  

 final  double progress;

/// Create a copy of VideoProofState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$VideoProofCompressingCopyWith<VideoProofCompressing> get copyWith => _$VideoProofCompressingCopyWithImpl<VideoProofCompressing>(this, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is VideoProofCompressing&&(identical(other.progress, progress) || other.progress == progress));
}


@override
int get hashCode => Object.hash(runtimeType,progress);

@override
String toString() {
  return 'VideoProofState.compressing(progress: $progress)';
}


}

/// @nodoc
abstract mixin class $VideoProofCompressingCopyWith<$Res> implements $VideoProofStateCopyWith<$Res> {
  factory $VideoProofCompressingCopyWith(VideoProofCompressing value, $Res Function(VideoProofCompressing) _then) = _$VideoProofCompressingCopyWithImpl;
@useResult
$Res call({
 double progress
});




}
/// @nodoc
class _$VideoProofCompressingCopyWithImpl<$Res>
    implements $VideoProofCompressingCopyWith<$Res> {
  _$VideoProofCompressingCopyWithImpl(this._self, this._then);

  final VideoProofCompressing _self;
  final $Res Function(VideoProofCompressing) _then;

/// Create a copy of VideoProofState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? progress = null,}) {
  return _then(VideoProofCompressing(
null == progress ? _self.progress : progress // ignore: cast_nullable_to_non_nullable
as double,
  ));
}


}

/// @nodoc


class VideoProofCompressed implements VideoProofState {
  const VideoProofCompressed(this.filePath, this.fileSize, this.durationSeconds);
  

 final  String filePath;
 final  int fileSize;
 final  int durationSeconds;

/// Create a copy of VideoProofState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$VideoProofCompressedCopyWith<VideoProofCompressed> get copyWith => _$VideoProofCompressedCopyWithImpl<VideoProofCompressed>(this, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is VideoProofCompressed&&(identical(other.filePath, filePath) || other.filePath == filePath)&&(identical(other.fileSize, fileSize) || other.fileSize == fileSize)&&(identical(other.durationSeconds, durationSeconds) || other.durationSeconds == durationSeconds));
}


@override
int get hashCode => Object.hash(runtimeType,filePath,fileSize,durationSeconds);

@override
String toString() {
  return 'VideoProofState.compressed(filePath: $filePath, fileSize: $fileSize, durationSeconds: $durationSeconds)';
}


}

/// @nodoc
abstract mixin class $VideoProofCompressedCopyWith<$Res> implements $VideoProofStateCopyWith<$Res> {
  factory $VideoProofCompressedCopyWith(VideoProofCompressed value, $Res Function(VideoProofCompressed) _then) = _$VideoProofCompressedCopyWithImpl;
@useResult
$Res call({
 String filePath, int fileSize, int durationSeconds
});




}
/// @nodoc
class _$VideoProofCompressedCopyWithImpl<$Res>
    implements $VideoProofCompressedCopyWith<$Res> {
  _$VideoProofCompressedCopyWithImpl(this._self, this._then);

  final VideoProofCompressed _self;
  final $Res Function(VideoProofCompressed) _then;

/// Create a copy of VideoProofState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? filePath = null,Object? fileSize = null,Object? durationSeconds = null,}) {
  return _then(VideoProofCompressed(
null == filePath ? _self.filePath : filePath // ignore: cast_nullable_to_non_nullable
as String,null == fileSize ? _self.fileSize : fileSize // ignore: cast_nullable_to_non_nullable
as int,null == durationSeconds ? _self.durationSeconds : durationSeconds // ignore: cast_nullable_to_non_nullable
as int,
  ));
}


}

/// @nodoc


class VideoProofUploading implements VideoProofState {
  const VideoProofUploading(this.progress);
  

 final  UploadProgress progress;

/// Create a copy of VideoProofState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$VideoProofUploadingCopyWith<VideoProofUploading> get copyWith => _$VideoProofUploadingCopyWithImpl<VideoProofUploading>(this, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is VideoProofUploading&&(identical(other.progress, progress) || other.progress == progress));
}


@override
int get hashCode => Object.hash(runtimeType,progress);

@override
String toString() {
  return 'VideoProofState.uploading(progress: $progress)';
}


}

/// @nodoc
abstract mixin class $VideoProofUploadingCopyWith<$Res> implements $VideoProofStateCopyWith<$Res> {
  factory $VideoProofUploadingCopyWith(VideoProofUploading value, $Res Function(VideoProofUploading) _then) = _$VideoProofUploadingCopyWithImpl;
@useResult
$Res call({
 UploadProgress progress
});


$UploadProgressCopyWith<$Res> get progress;

}
/// @nodoc
class _$VideoProofUploadingCopyWithImpl<$Res>
    implements $VideoProofUploadingCopyWith<$Res> {
  _$VideoProofUploadingCopyWithImpl(this._self, this._then);

  final VideoProofUploading _self;
  final $Res Function(VideoProofUploading) _then;

/// Create a copy of VideoProofState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? progress = null,}) {
  return _then(VideoProofUploading(
null == progress ? _self.progress : progress // ignore: cast_nullable_to_non_nullable
as UploadProgress,
  ));
}

/// Create a copy of VideoProofState
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$UploadProgressCopyWith<$Res> get progress {
  
  return $UploadProgressCopyWith<$Res>(_self.progress, (value) {
    return _then(_self.copyWith(progress: value));
  });
}
}

/// @nodoc


class VideoProofComplete implements VideoProofState {
  const VideoProofComplete(this.publicUrl);
  

 final  String publicUrl;

/// Create a copy of VideoProofState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$VideoProofCompleteCopyWith<VideoProofComplete> get copyWith => _$VideoProofCompleteCopyWithImpl<VideoProofComplete>(this, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is VideoProofComplete&&(identical(other.publicUrl, publicUrl) || other.publicUrl == publicUrl));
}


@override
int get hashCode => Object.hash(runtimeType,publicUrl);

@override
String toString() {
  return 'VideoProofState.complete(publicUrl: $publicUrl)';
}


}

/// @nodoc
abstract mixin class $VideoProofCompleteCopyWith<$Res> implements $VideoProofStateCopyWith<$Res> {
  factory $VideoProofCompleteCopyWith(VideoProofComplete value, $Res Function(VideoProofComplete) _then) = _$VideoProofCompleteCopyWithImpl;
@useResult
$Res call({
 String publicUrl
});




}
/// @nodoc
class _$VideoProofCompleteCopyWithImpl<$Res>
    implements $VideoProofCompleteCopyWith<$Res> {
  _$VideoProofCompleteCopyWithImpl(this._self, this._then);

  final VideoProofComplete _self;
  final $Res Function(VideoProofComplete) _then;

/// Create a copy of VideoProofState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? publicUrl = null,}) {
  return _then(VideoProofComplete(
null == publicUrl ? _self.publicUrl : publicUrl // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

/// @nodoc


class VideoProofError implements VideoProofState {
  const VideoProofError(this.message);
  

 final  String message;

/// Create a copy of VideoProofState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$VideoProofErrorCopyWith<VideoProofError> get copyWith => _$VideoProofErrorCopyWithImpl<VideoProofError>(this, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is VideoProofError&&(identical(other.message, message) || other.message == message));
}


@override
int get hashCode => Object.hash(runtimeType,message);

@override
String toString() {
  return 'VideoProofState.error(message: $message)';
}


}

/// @nodoc
abstract mixin class $VideoProofErrorCopyWith<$Res> implements $VideoProofStateCopyWith<$Res> {
  factory $VideoProofErrorCopyWith(VideoProofError value, $Res Function(VideoProofError) _then) = _$VideoProofErrorCopyWithImpl;
@useResult
$Res call({
 String message
});




}
/// @nodoc
class _$VideoProofErrorCopyWithImpl<$Res>
    implements $VideoProofErrorCopyWith<$Res> {
  _$VideoProofErrorCopyWithImpl(this._self, this._then);

  final VideoProofError _self;
  final $Res Function(VideoProofError) _then;

/// Create a copy of VideoProofState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? message = null,}) {
  return _then(VideoProofError(
null == message ? _self.message : message // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

/// @nodoc


class VideoProofPermissionDenied implements VideoProofState {
  const VideoProofPermissionDenied();
  






@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is VideoProofPermissionDenied);
}


@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
  return 'VideoProofState.permissionDenied()';
}


}




// dart format on
