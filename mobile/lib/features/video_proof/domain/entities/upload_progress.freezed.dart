// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'upload_progress.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$UploadProgress {

 int get bytesSent; int get totalBytes;
/// Create a copy of UploadProgress
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$UploadProgressCopyWith<UploadProgress> get copyWith => _$UploadProgressCopyWithImpl<UploadProgress>(this as UploadProgress, _$identity);

  /// Serializes this UploadProgress to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is UploadProgress&&(identical(other.bytesSent, bytesSent) || other.bytesSent == bytesSent)&&(identical(other.totalBytes, totalBytes) || other.totalBytes == totalBytes));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,bytesSent,totalBytes);

@override
String toString() {
  return 'UploadProgress(bytesSent: $bytesSent, totalBytes: $totalBytes)';
}


}

/// @nodoc
abstract mixin class $UploadProgressCopyWith<$Res>  {
  factory $UploadProgressCopyWith(UploadProgress value, $Res Function(UploadProgress) _then) = _$UploadProgressCopyWithImpl;
@useResult
$Res call({
 int bytesSent, int totalBytes
});




}
/// @nodoc
class _$UploadProgressCopyWithImpl<$Res>
    implements $UploadProgressCopyWith<$Res> {
  _$UploadProgressCopyWithImpl(this._self, this._then);

  final UploadProgress _self;
  final $Res Function(UploadProgress) _then;

/// Create a copy of UploadProgress
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? bytesSent = null,Object? totalBytes = null,}) {
  return _then(_self.copyWith(
bytesSent: null == bytesSent ? _self.bytesSent : bytesSent // ignore: cast_nullable_to_non_nullable
as int,totalBytes: null == totalBytes ? _self.totalBytes : totalBytes // ignore: cast_nullable_to_non_nullable
as int,
  ));
}

}


/// Adds pattern-matching-related methods to [UploadProgress].
extension UploadProgressPatterns on UploadProgress {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _UploadProgress value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _UploadProgress() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _UploadProgress value)  $default,){
final _that = this;
switch (_that) {
case _UploadProgress():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _UploadProgress value)?  $default,){
final _that = this;
switch (_that) {
case _UploadProgress() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( int bytesSent,  int totalBytes)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _UploadProgress() when $default != null:
return $default(_that.bytesSent,_that.totalBytes);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( int bytesSent,  int totalBytes)  $default,) {final _that = this;
switch (_that) {
case _UploadProgress():
return $default(_that.bytesSent,_that.totalBytes);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( int bytesSent,  int totalBytes)?  $default,) {final _that = this;
switch (_that) {
case _UploadProgress() when $default != null:
return $default(_that.bytesSent,_that.totalBytes);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _UploadProgress extends UploadProgress {
  const _UploadProgress({required this.bytesSent, required this.totalBytes}): super._();
  factory _UploadProgress.fromJson(Map<String, dynamic> json) => _$UploadProgressFromJson(json);

@override final  int bytesSent;
@override final  int totalBytes;

/// Create a copy of UploadProgress
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$UploadProgressCopyWith<_UploadProgress> get copyWith => __$UploadProgressCopyWithImpl<_UploadProgress>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$UploadProgressToJson(this, );
}

@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _UploadProgress&&(identical(other.bytesSent, bytesSent) || other.bytesSent == bytesSent)&&(identical(other.totalBytes, totalBytes) || other.totalBytes == totalBytes));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,bytesSent,totalBytes);

@override
String toString() {
  return 'UploadProgress(bytesSent: $bytesSent, totalBytes: $totalBytes)';
}


}

/// @nodoc
abstract mixin class _$UploadProgressCopyWith<$Res> implements $UploadProgressCopyWith<$Res> {
  factory _$UploadProgressCopyWith(_UploadProgress value, $Res Function(_UploadProgress) _then) = __$UploadProgressCopyWithImpl;
@override @useResult
$Res call({
 int bytesSent, int totalBytes
});




}
/// @nodoc
class __$UploadProgressCopyWithImpl<$Res>
    implements _$UploadProgressCopyWith<$Res> {
  __$UploadProgressCopyWithImpl(this._self, this._then);

  final _UploadProgress _self;
  final $Res Function(_UploadProgress) _then;

/// Create a copy of UploadProgress
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? bytesSent = null,Object? totalBytes = null,}) {
  return _then(_UploadProgress(
bytesSent: null == bytesSent ? _self.bytesSent : bytesSent // ignore: cast_nullable_to_non_nullable
as int,totalBytes: null == totalBytes ? _self.totalBytes : totalBytes // ignore: cast_nullable_to_non_nullable
as int,
  ));
}


}

// dart format on
