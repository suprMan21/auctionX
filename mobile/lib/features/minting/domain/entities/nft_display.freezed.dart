// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'nft_display.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$NftDisplay {

 String get verificationNumber; String get itemName; String? get itemImage; String? get sellerName; int get verifiedCount;
/// Create a copy of NftDisplay
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$NftDisplayCopyWith<NftDisplay> get copyWith => _$NftDisplayCopyWithImpl<NftDisplay>(this as NftDisplay, _$identity);

  /// Serializes this NftDisplay to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is NftDisplay&&(identical(other.verificationNumber, verificationNumber) || other.verificationNumber == verificationNumber)&&(identical(other.itemName, itemName) || other.itemName == itemName)&&(identical(other.itemImage, itemImage) || other.itemImage == itemImage)&&(identical(other.sellerName, sellerName) || other.sellerName == sellerName)&&(identical(other.verifiedCount, verifiedCount) || other.verifiedCount == verifiedCount));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,verificationNumber,itemName,itemImage,sellerName,verifiedCount);

@override
String toString() {
  return 'NftDisplay(verificationNumber: $verificationNumber, itemName: $itemName, itemImage: $itemImage, sellerName: $sellerName, verifiedCount: $verifiedCount)';
}


}

/// @nodoc
abstract mixin class $NftDisplayCopyWith<$Res>  {
  factory $NftDisplayCopyWith(NftDisplay value, $Res Function(NftDisplay) _then) = _$NftDisplayCopyWithImpl;
@useResult
$Res call({
 String verificationNumber, String itemName, String? itemImage, String? sellerName, int verifiedCount
});




}
/// @nodoc
class _$NftDisplayCopyWithImpl<$Res>
    implements $NftDisplayCopyWith<$Res> {
  _$NftDisplayCopyWithImpl(this._self, this._then);

  final NftDisplay _self;
  final $Res Function(NftDisplay) _then;

/// Create a copy of NftDisplay
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? verificationNumber = null,Object? itemName = null,Object? itemImage = freezed,Object? sellerName = freezed,Object? verifiedCount = null,}) {
  return _then(_self.copyWith(
verificationNumber: null == verificationNumber ? _self.verificationNumber : verificationNumber // ignore: cast_nullable_to_non_nullable
as String,itemName: null == itemName ? _self.itemName : itemName // ignore: cast_nullable_to_non_nullable
as String,itemImage: freezed == itemImage ? _self.itemImage : itemImage // ignore: cast_nullable_to_non_nullable
as String?,sellerName: freezed == sellerName ? _self.sellerName : sellerName // ignore: cast_nullable_to_non_nullable
as String?,verifiedCount: null == verifiedCount ? _self.verifiedCount : verifiedCount // ignore: cast_nullable_to_non_nullable
as int,
  ));
}

}


/// Adds pattern-matching-related methods to [NftDisplay].
extension NftDisplayPatterns on NftDisplay {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _NftDisplay value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _NftDisplay() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _NftDisplay value)  $default,){
final _that = this;
switch (_that) {
case _NftDisplay():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _NftDisplay value)?  $default,){
final _that = this;
switch (_that) {
case _NftDisplay() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String verificationNumber,  String itemName,  String? itemImage,  String? sellerName,  int verifiedCount)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _NftDisplay() when $default != null:
return $default(_that.verificationNumber,_that.itemName,_that.itemImage,_that.sellerName,_that.verifiedCount);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String verificationNumber,  String itemName,  String? itemImage,  String? sellerName,  int verifiedCount)  $default,) {final _that = this;
switch (_that) {
case _NftDisplay():
return $default(_that.verificationNumber,_that.itemName,_that.itemImage,_that.sellerName,_that.verifiedCount);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String verificationNumber,  String itemName,  String? itemImage,  String? sellerName,  int verifiedCount)?  $default,) {final _that = this;
switch (_that) {
case _NftDisplay() when $default != null:
return $default(_that.verificationNumber,_that.itemName,_that.itemImage,_that.sellerName,_that.verifiedCount);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _NftDisplay implements NftDisplay {
  const _NftDisplay({required this.verificationNumber, required this.itemName, this.itemImage, this.sellerName, required this.verifiedCount});
  factory _NftDisplay.fromJson(Map<String, dynamic> json) => _$NftDisplayFromJson(json);

@override final  String verificationNumber;
@override final  String itemName;
@override final  String? itemImage;
@override final  String? sellerName;
@override final  int verifiedCount;

/// Create a copy of NftDisplay
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$NftDisplayCopyWith<_NftDisplay> get copyWith => __$NftDisplayCopyWithImpl<_NftDisplay>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$NftDisplayToJson(this, );
}

@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _NftDisplay&&(identical(other.verificationNumber, verificationNumber) || other.verificationNumber == verificationNumber)&&(identical(other.itemName, itemName) || other.itemName == itemName)&&(identical(other.itemImage, itemImage) || other.itemImage == itemImage)&&(identical(other.sellerName, sellerName) || other.sellerName == sellerName)&&(identical(other.verifiedCount, verifiedCount) || other.verifiedCount == verifiedCount));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,verificationNumber,itemName,itemImage,sellerName,verifiedCount);

@override
String toString() {
  return 'NftDisplay(verificationNumber: $verificationNumber, itemName: $itemName, itemImage: $itemImage, sellerName: $sellerName, verifiedCount: $verifiedCount)';
}


}

/// @nodoc
abstract mixin class _$NftDisplayCopyWith<$Res> implements $NftDisplayCopyWith<$Res> {
  factory _$NftDisplayCopyWith(_NftDisplay value, $Res Function(_NftDisplay) _then) = __$NftDisplayCopyWithImpl;
@override @useResult
$Res call({
 String verificationNumber, String itemName, String? itemImage, String? sellerName, int verifiedCount
});




}
/// @nodoc
class __$NftDisplayCopyWithImpl<$Res>
    implements _$NftDisplayCopyWith<$Res> {
  __$NftDisplayCopyWithImpl(this._self, this._then);

  final _NftDisplay _self;
  final $Res Function(_NftDisplay) _then;

/// Create a copy of NftDisplay
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? verificationNumber = null,Object? itemName = null,Object? itemImage = freezed,Object? sellerName = freezed,Object? verifiedCount = null,}) {
  return _then(_NftDisplay(
verificationNumber: null == verificationNumber ? _self.verificationNumber : verificationNumber // ignore: cast_nullable_to_non_nullable
as String,itemName: null == itemName ? _self.itemName : itemName // ignore: cast_nullable_to_non_nullable
as String,itemImage: freezed == itemImage ? _self.itemImage : itemImage // ignore: cast_nullable_to_non_nullable
as String?,sellerName: freezed == sellerName ? _self.sellerName : sellerName // ignore: cast_nullable_to_non_nullable
as String?,verifiedCount: null == verifiedCount ? _self.verifiedCount : verifiedCount // ignore: cast_nullable_to_non_nullable
as int,
  ));
}


}

// dart format on
