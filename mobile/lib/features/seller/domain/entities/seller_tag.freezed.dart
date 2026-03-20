// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'seller_tag.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$SellerTag {

 String get id; String get tagUid; String get itemId; String get tenantId; String get status; String? get listingTitle; String? get nftTokenId; int get scanCount; DateTime get registeredAt;
/// Create a copy of SellerTag
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$SellerTagCopyWith<SellerTag> get copyWith => _$SellerTagCopyWithImpl<SellerTag>(this as SellerTag, _$identity);

  /// Serializes this SellerTag to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is SellerTag&&(identical(other.id, id) || other.id == id)&&(identical(other.tagUid, tagUid) || other.tagUid == tagUid)&&(identical(other.itemId, itemId) || other.itemId == itemId)&&(identical(other.tenantId, tenantId) || other.tenantId == tenantId)&&(identical(other.status, status) || other.status == status)&&(identical(other.listingTitle, listingTitle) || other.listingTitle == listingTitle)&&(identical(other.nftTokenId, nftTokenId) || other.nftTokenId == nftTokenId)&&(identical(other.scanCount, scanCount) || other.scanCount == scanCount)&&(identical(other.registeredAt, registeredAt) || other.registeredAt == registeredAt));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,id,tagUid,itemId,tenantId,status,listingTitle,nftTokenId,scanCount,registeredAt);

@override
String toString() {
  return 'SellerTag(id: $id, tagUid: $tagUid, itemId: $itemId, tenantId: $tenantId, status: $status, listingTitle: $listingTitle, nftTokenId: $nftTokenId, scanCount: $scanCount, registeredAt: $registeredAt)';
}


}

/// @nodoc
abstract mixin class $SellerTagCopyWith<$Res>  {
  factory $SellerTagCopyWith(SellerTag value, $Res Function(SellerTag) _then) = _$SellerTagCopyWithImpl;
@useResult
$Res call({
 String id, String tagUid, String itemId, String tenantId, String status, String? listingTitle, String? nftTokenId, int scanCount, DateTime registeredAt
});




}
/// @nodoc
class _$SellerTagCopyWithImpl<$Res>
    implements $SellerTagCopyWith<$Res> {
  _$SellerTagCopyWithImpl(this._self, this._then);

  final SellerTag _self;
  final $Res Function(SellerTag) _then;

/// Create a copy of SellerTag
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? tagUid = null,Object? itemId = null,Object? tenantId = null,Object? status = null,Object? listingTitle = freezed,Object? nftTokenId = freezed,Object? scanCount = null,Object? registeredAt = null,}) {
  return _then(_self.copyWith(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,tagUid: null == tagUid ? _self.tagUid : tagUid // ignore: cast_nullable_to_non_nullable
as String,itemId: null == itemId ? _self.itemId : itemId // ignore: cast_nullable_to_non_nullable
as String,tenantId: null == tenantId ? _self.tenantId : tenantId // ignore: cast_nullable_to_non_nullable
as String,status: null == status ? _self.status : status // ignore: cast_nullable_to_non_nullable
as String,listingTitle: freezed == listingTitle ? _self.listingTitle : listingTitle // ignore: cast_nullable_to_non_nullable
as String?,nftTokenId: freezed == nftTokenId ? _self.nftTokenId : nftTokenId // ignore: cast_nullable_to_non_nullable
as String?,scanCount: null == scanCount ? _self.scanCount : scanCount // ignore: cast_nullable_to_non_nullable
as int,registeredAt: null == registeredAt ? _self.registeredAt : registeredAt // ignore: cast_nullable_to_non_nullable
as DateTime,
  ));
}

}


/// Adds pattern-matching-related methods to [SellerTag].
extension SellerTagPatterns on SellerTag {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _SellerTag value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _SellerTag() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _SellerTag value)  $default,){
final _that = this;
switch (_that) {
case _SellerTag():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _SellerTag value)?  $default,){
final _that = this;
switch (_that) {
case _SellerTag() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String id,  String tagUid,  String itemId,  String tenantId,  String status,  String? listingTitle,  String? nftTokenId,  int scanCount,  DateTime registeredAt)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _SellerTag() when $default != null:
return $default(_that.id,_that.tagUid,_that.itemId,_that.tenantId,_that.status,_that.listingTitle,_that.nftTokenId,_that.scanCount,_that.registeredAt);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String id,  String tagUid,  String itemId,  String tenantId,  String status,  String? listingTitle,  String? nftTokenId,  int scanCount,  DateTime registeredAt)  $default,) {final _that = this;
switch (_that) {
case _SellerTag():
return $default(_that.id,_that.tagUid,_that.itemId,_that.tenantId,_that.status,_that.listingTitle,_that.nftTokenId,_that.scanCount,_that.registeredAt);}
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String id,  String tagUid,  String itemId,  String tenantId,  String status,  String? listingTitle,  String? nftTokenId,  int scanCount,  DateTime registeredAt)?  $default,) {final _that = this;
switch (_that) {
case _SellerTag() when $default != null:
return $default(_that.id,_that.tagUid,_that.itemId,_that.tenantId,_that.status,_that.listingTitle,_that.nftTokenId,_that.scanCount,_that.registeredAt);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _SellerTag implements SellerTag {
  const _SellerTag({required this.id, required this.tagUid, required this.itemId, required this.tenantId, required this.status, this.listingTitle, this.nftTokenId, this.scanCount = 0, required this.registeredAt});
  factory _SellerTag.fromJson(Map<String, dynamic> json) => _$SellerTagFromJson(json);

@override final  String id;
@override final  String tagUid;
@override final  String itemId;
@override final  String tenantId;
@override final  String status;
@override final  String? listingTitle;
@override final  String? nftTokenId;
@override@JsonKey() final  int scanCount;
@override final  DateTime registeredAt;

/// Create a copy of SellerTag
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$SellerTagCopyWith<_SellerTag> get copyWith => __$SellerTagCopyWithImpl<_SellerTag>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$SellerTagToJson(this, );
}

@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _SellerTag&&(identical(other.id, id) || other.id == id)&&(identical(other.tagUid, tagUid) || other.tagUid == tagUid)&&(identical(other.itemId, itemId) || other.itemId == itemId)&&(identical(other.tenantId, tenantId) || other.tenantId == tenantId)&&(identical(other.status, status) || other.status == status)&&(identical(other.listingTitle, listingTitle) || other.listingTitle == listingTitle)&&(identical(other.nftTokenId, nftTokenId) || other.nftTokenId == nftTokenId)&&(identical(other.scanCount, scanCount) || other.scanCount == scanCount)&&(identical(other.registeredAt, registeredAt) || other.registeredAt == registeredAt));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,id,tagUid,itemId,tenantId,status,listingTitle,nftTokenId,scanCount,registeredAt);

@override
String toString() {
  return 'SellerTag(id: $id, tagUid: $tagUid, itemId: $itemId, tenantId: $tenantId, status: $status, listingTitle: $listingTitle, nftTokenId: $nftTokenId, scanCount: $scanCount, registeredAt: $registeredAt)';
}


}

/// @nodoc
abstract mixin class _$SellerTagCopyWith<$Res> implements $SellerTagCopyWith<$Res> {
  factory _$SellerTagCopyWith(_SellerTag value, $Res Function(_SellerTag) _then) = __$SellerTagCopyWithImpl;
@override @useResult
$Res call({
 String id, String tagUid, String itemId, String tenantId, String status, String? listingTitle, String? nftTokenId, int scanCount, DateTime registeredAt
});




}
/// @nodoc
class __$SellerTagCopyWithImpl<$Res>
    implements _$SellerTagCopyWith<$Res> {
  __$SellerTagCopyWithImpl(this._self, this._then);

  final _SellerTag _self;
  final $Res Function(_SellerTag) _then;

/// Create a copy of SellerTag
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? tagUid = null,Object? itemId = null,Object? tenantId = null,Object? status = null,Object? listingTitle = freezed,Object? nftTokenId = freezed,Object? scanCount = null,Object? registeredAt = null,}) {
  return _then(_SellerTag(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,tagUid: null == tagUid ? _self.tagUid : tagUid // ignore: cast_nullable_to_non_nullable
as String,itemId: null == itemId ? _self.itemId : itemId // ignore: cast_nullable_to_non_nullable
as String,tenantId: null == tenantId ? _self.tenantId : tenantId // ignore: cast_nullable_to_non_nullable
as String,status: null == status ? _self.status : status // ignore: cast_nullable_to_non_nullable
as String,listingTitle: freezed == listingTitle ? _self.listingTitle : listingTitle // ignore: cast_nullable_to_non_nullable
as String?,nftTokenId: freezed == nftTokenId ? _self.nftTokenId : nftTokenId // ignore: cast_nullable_to_non_nullable
as String?,scanCount: null == scanCount ? _self.scanCount : scanCount // ignore: cast_nullable_to_non_nullable
as int,registeredAt: null == registeredAt ? _self.registeredAt : registeredAt // ignore: cast_nullable_to_non_nullable
as DateTime,
  ));
}


}

// dart format on
