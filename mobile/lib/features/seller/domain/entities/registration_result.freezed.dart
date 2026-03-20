// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'registration_result.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$RegistrationResult {

 String get tagId; String get tagUid; String get itemId; String get status;
/// Create a copy of RegistrationResult
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$RegistrationResultCopyWith<RegistrationResult> get copyWith => _$RegistrationResultCopyWithImpl<RegistrationResult>(this as RegistrationResult, _$identity);

  /// Serializes this RegistrationResult to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is RegistrationResult&&(identical(other.tagId, tagId) || other.tagId == tagId)&&(identical(other.tagUid, tagUid) || other.tagUid == tagUid)&&(identical(other.itemId, itemId) || other.itemId == itemId)&&(identical(other.status, status) || other.status == status));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,tagId,tagUid,itemId,status);

@override
String toString() {
  return 'RegistrationResult(tagId: $tagId, tagUid: $tagUid, itemId: $itemId, status: $status)';
}


}

/// @nodoc
abstract mixin class $RegistrationResultCopyWith<$Res>  {
  factory $RegistrationResultCopyWith(RegistrationResult value, $Res Function(RegistrationResult) _then) = _$RegistrationResultCopyWithImpl;
@useResult
$Res call({
 String tagId, String tagUid, String itemId, String status
});




}
/// @nodoc
class _$RegistrationResultCopyWithImpl<$Res>
    implements $RegistrationResultCopyWith<$Res> {
  _$RegistrationResultCopyWithImpl(this._self, this._then);

  final RegistrationResult _self;
  final $Res Function(RegistrationResult) _then;

/// Create a copy of RegistrationResult
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? tagId = null,Object? tagUid = null,Object? itemId = null,Object? status = null,}) {
  return _then(_self.copyWith(
tagId: null == tagId ? _self.tagId : tagId // ignore: cast_nullable_to_non_nullable
as String,tagUid: null == tagUid ? _self.tagUid : tagUid // ignore: cast_nullable_to_non_nullable
as String,itemId: null == itemId ? _self.itemId : itemId // ignore: cast_nullable_to_non_nullable
as String,status: null == status ? _self.status : status // ignore: cast_nullable_to_non_nullable
as String,
  ));
}

}


/// Adds pattern-matching-related methods to [RegistrationResult].
extension RegistrationResultPatterns on RegistrationResult {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _RegistrationResult value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _RegistrationResult() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _RegistrationResult value)  $default,){
final _that = this;
switch (_that) {
case _RegistrationResult():
return $default(_that);}
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _RegistrationResult value)?  $default,){
final _that = this;
switch (_that) {
case _RegistrationResult() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String tagId,  String tagUid,  String itemId,  String status)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _RegistrationResult() when $default != null:
return $default(_that.tagId,_that.tagUid,_that.itemId,_that.status);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String tagId,  String tagUid,  String itemId,  String status)  $default,) {final _that = this;
switch (_that) {
case _RegistrationResult():
return $default(_that.tagId,_that.tagUid,_that.itemId,_that.status);}
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String tagId,  String tagUid,  String itemId,  String status)?  $default,) {final _that = this;
switch (_that) {
case _RegistrationResult() when $default != null:
return $default(_that.tagId,_that.tagUid,_that.itemId,_that.status);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _RegistrationResult implements RegistrationResult {
  const _RegistrationResult({required this.tagId, required this.tagUid, required this.itemId, required this.status});
  factory _RegistrationResult.fromJson(Map<String, dynamic> json) => _$RegistrationResultFromJson(json);

@override final  String tagId;
@override final  String tagUid;
@override final  String itemId;
@override final  String status;

/// Create a copy of RegistrationResult
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$RegistrationResultCopyWith<_RegistrationResult> get copyWith => __$RegistrationResultCopyWithImpl<_RegistrationResult>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$RegistrationResultToJson(this, );
}

@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _RegistrationResult&&(identical(other.tagId, tagId) || other.tagId == tagId)&&(identical(other.tagUid, tagUid) || other.tagUid == tagUid)&&(identical(other.itemId, itemId) || other.itemId == itemId)&&(identical(other.status, status) || other.status == status));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,tagId,tagUid,itemId,status);

@override
String toString() {
  return 'RegistrationResult(tagId: $tagId, tagUid: $tagUid, itemId: $itemId, status: $status)';
}


}

/// @nodoc
abstract mixin class _$RegistrationResultCopyWith<$Res> implements $RegistrationResultCopyWith<$Res> {
  factory _$RegistrationResultCopyWith(_RegistrationResult value, $Res Function(_RegistrationResult) _then) = __$RegistrationResultCopyWithImpl;
@override @useResult
$Res call({
 String tagId, String tagUid, String itemId, String status
});




}
/// @nodoc
class __$RegistrationResultCopyWithImpl<$Res>
    implements _$RegistrationResultCopyWith<$Res> {
  __$RegistrationResultCopyWithImpl(this._self, this._then);

  final _RegistrationResult _self;
  final $Res Function(_RegistrationResult) _then;

/// Create a copy of RegistrationResult
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? tagId = null,Object? tagUid = null,Object? itemId = null,Object? status = null,}) {
  return _then(_RegistrationResult(
tagId: null == tagId ? _self.tagId : tagId // ignore: cast_nullable_to_non_nullable
as String,tagUid: null == tagUid ? _self.tagUid : tagUid // ignore: cast_nullable_to_non_nullable
as String,itemId: null == itemId ? _self.itemId : itemId // ignore: cast_nullable_to_non_nullable
as String,status: null == status ? _self.status : status // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

// dart format on
