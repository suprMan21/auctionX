// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'video_proof.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$VideoProof {

 String get tagId; String get localPath; int get fileSizeBytes; int get durationMs; String? get uploadUrl; String? get publicUrl; String? get videoKey;
/// Create a copy of VideoProof
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$VideoProofCopyWith<VideoProof> get copyWith => _$VideoProofCopyWithImpl<VideoProof>(this as VideoProof, _$identity);

  /// Serializes this VideoProof to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is VideoProof&&(identical(other.tagId, tagId) || other.tagId == tagId)&&(identical(other.localPath, localPath) || other.localPath == localPath)&&(identical(other.fileSizeBytes, fileSizeBytes) || other.fileSizeBytes == fileSizeBytes)&&(identical(other.durationMs, durationMs) || other.durationMs == durationMs)&&(identical(other.uploadUrl, uploadUrl) || other.uploadUrl == uploadUrl)&&(identical(other.publicUrl, publicUrl) || other.publicUrl == publicUrl)&&(identical(other.videoKey, videoKey) || other.videoKey == videoKey));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,tagId,localPath,fileSizeBytes,durationMs,uploadUrl,publicUrl,videoKey);

@override
String toString() {
  return 'VideoProof(tagId: $tagId, localPath: $localPath, fileSizeBytes: $fileSizeBytes, durationMs: $durationMs, uploadUrl: $uploadUrl, publicUrl: $publicUrl, videoKey: $videoKey)';
}


}

/// @nodoc
abstract mixin class $VideoProofCopyWith<$Res>  {
  factory $VideoProofCopyWith(VideoProof value, $Res Function(VideoProof) _then) = _$VideoProofCopyWithImpl;
@useResult
$Res call({
 String tagId, String localPath, int fileSizeBytes, int durationMs, String? uploadUrl, String? publicUrl, String? videoKey
});




}
/// @nodoc
class _$VideoProofCopyWithImpl<$Res>
    implements $VideoProofCopyWith<$Res> {
  _$VideoProofCopyWithImpl(this._self, this._then);

  final VideoProof _self;
  final $Res Function(VideoProof) _then;

/// Create a copy of VideoProof
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? tagId = null,Object? localPath = null,Object? fileSizeBytes = null,Object? durationMs = null,Object? uploadUrl = freezed,Object? publicUrl = freezed,Object? videoKey = freezed,}) {
  return _then(_self.copyWith(
tagId: null == tagId ? _self.tagId : tagId // ignore: cast_nullable_to_non_nullable
as String,localPath: null == localPath ? _self.localPath : localPath // ignore: cast_nullable_to_non_nullable
as String,fileSizeBytes: null == fileSizeBytes ? _self.fileSizeBytes : fileSizeBytes // ignore: cast_nullable_to_non_nullable
as int,durationMs: null == durationMs ? _self.durationMs : durationMs // ignore: cast_nullable_to_non_nullable
as int,uploadUrl: freezed == uploadUrl ? _self.uploadUrl : uploadUrl // ignore: cast_nullable_to_non_nullable
as String?,publicUrl: freezed == publicUrl ? _self.publicUrl : publicUrl // ignore: cast_nullable_to_non_nullable
as String?,videoKey: freezed == videoKey ? _self.videoKey : videoKey // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}

}


/// Adds pattern-matching-related methods to [VideoProof].
extension VideoProofPatterns on VideoProof {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _VideoProof value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _VideoProof() when $default != null:
return $default(_that);case _:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _VideoProof value)  $default,){
final _that = this;
switch (_that) {
case _VideoProof():
return $default(_that);case _:
  throw StateError('Unexpected subclass');

}
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _VideoProof value)?  $default,){
final _that = this;
switch (_that) {
case _VideoProof() when $default != null:
return $default(_that);case _:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String tagId,  String localPath,  int fileSizeBytes,  int durationMs,  String? uploadUrl,  String? publicUrl,  String? videoKey)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _VideoProof() when $default != null:
return $default(_that.tagId,_that.localPath,_that.fileSizeBytes,_that.durationMs,_that.uploadUrl,_that.publicUrl,_that.videoKey);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String tagId,  String localPath,  int fileSizeBytes,  int durationMs,  String? uploadUrl,  String? publicUrl,  String? videoKey)  $default,) {final _that = this;
switch (_that) {
case _VideoProof():
return $default(_that.tagId,_that.localPath,_that.fileSizeBytes,_that.durationMs,_that.uploadUrl,_that.publicUrl,_that.videoKey);case _:
  throw StateError('Unexpected subclass');

}
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String tagId,  String localPath,  int fileSizeBytes,  int durationMs,  String? uploadUrl,  String? publicUrl,  String? videoKey)?  $default,) {final _that = this;
switch (_that) {
case _VideoProof() when $default != null:
return $default(_that.tagId,_that.localPath,_that.fileSizeBytes,_that.durationMs,_that.uploadUrl,_that.publicUrl,_that.videoKey);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _VideoProof extends VideoProof {
  const _VideoProof({required this.tagId, required this.localPath, required this.fileSizeBytes, required this.durationMs, this.uploadUrl, this.publicUrl, this.videoKey}): super._();
  factory _VideoProof.fromJson(Map<String, dynamic> json) => _$VideoProofFromJson(json);

@override final  String tagId;
@override final  String localPath;
@override final  int fileSizeBytes;
@override final  int durationMs;
@override final  String? uploadUrl;
@override final  String? publicUrl;
@override final  String? videoKey;

/// Create a copy of VideoProof
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$VideoProofCopyWith<_VideoProof> get copyWith => __$VideoProofCopyWithImpl<_VideoProof>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$VideoProofToJson(this, );
}

@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _VideoProof&&(identical(other.tagId, tagId) || other.tagId == tagId)&&(identical(other.localPath, localPath) || other.localPath == localPath)&&(identical(other.fileSizeBytes, fileSizeBytes) || other.fileSizeBytes == fileSizeBytes)&&(identical(other.durationMs, durationMs) || other.durationMs == durationMs)&&(identical(other.uploadUrl, uploadUrl) || other.uploadUrl == uploadUrl)&&(identical(other.publicUrl, publicUrl) || other.publicUrl == publicUrl)&&(identical(other.videoKey, videoKey) || other.videoKey == videoKey));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,tagId,localPath,fileSizeBytes,durationMs,uploadUrl,publicUrl,videoKey);

@override
String toString() {
  return 'VideoProof(tagId: $tagId, localPath: $localPath, fileSizeBytes: $fileSizeBytes, durationMs: $durationMs, uploadUrl: $uploadUrl, publicUrl: $publicUrl, videoKey: $videoKey)';
}


}

/// @nodoc
abstract mixin class _$VideoProofCopyWith<$Res> implements $VideoProofCopyWith<$Res> {
  factory _$VideoProofCopyWith(_VideoProof value, $Res Function(_VideoProof) _then) = __$VideoProofCopyWithImpl;
@override @useResult
$Res call({
 String tagId, String localPath, int fileSizeBytes, int durationMs, String? uploadUrl, String? publicUrl, String? videoKey
});




}
/// @nodoc
class __$VideoProofCopyWithImpl<$Res>
    implements _$VideoProofCopyWith<$Res> {
  __$VideoProofCopyWithImpl(this._self, this._then);

  final _VideoProof _self;
  final $Res Function(_VideoProof) _then;

/// Create a copy of VideoProof
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? tagId = null,Object? localPath = null,Object? fileSizeBytes = null,Object? durationMs = null,Object? uploadUrl = freezed,Object? publicUrl = freezed,Object? videoKey = freezed,}) {
  return _then(_VideoProof(
tagId: null == tagId ? _self.tagId : tagId // ignore: cast_nullable_to_non_nullable
as String,localPath: null == localPath ? _self.localPath : localPath // ignore: cast_nullable_to_non_nullable
as String,fileSizeBytes: null == fileSizeBytes ? _self.fileSizeBytes : fileSizeBytes // ignore: cast_nullable_to_non_nullable
as int,durationMs: null == durationMs ? _self.durationMs : durationMs // ignore: cast_nullable_to_non_nullable
as int,uploadUrl: freezed == uploadUrl ? _self.uploadUrl : uploadUrl // ignore: cast_nullable_to_non_nullable
as String?,publicUrl: freezed == publicUrl ? _self.publicUrl : publicUrl // ignore: cast_nullable_to_non_nullable
as String?,videoKey: freezed == videoKey ? _self.videoKey : videoKey // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}


}

// dart format on
