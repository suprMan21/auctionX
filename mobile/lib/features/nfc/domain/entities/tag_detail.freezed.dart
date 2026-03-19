// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'tag_detail.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$TagDetail {

 TagInfo get tag; List<VerificationEvent> get events; NftInfo? get nft; SellerInfo? get seller;
/// Create a copy of TagDetail
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$TagDetailCopyWith<TagDetail> get copyWith => _$TagDetailCopyWithImpl<TagDetail>(this as TagDetail, _$identity);

  /// Serializes this TagDetail to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is TagDetail&&(identical(other.tag, tag) || other.tag == tag)&&const DeepCollectionEquality().equals(other.events, events)&&(identical(other.nft, nft) || other.nft == nft)&&(identical(other.seller, seller) || other.seller == seller));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,tag,const DeepCollectionEquality().hash(events),nft,seller);

@override
String toString() {
  return 'TagDetail(tag: $tag, events: $events, nft: $nft, seller: $seller)';
}


}

/// @nodoc
abstract mixin class $TagDetailCopyWith<$Res>  {
  factory $TagDetailCopyWith(TagDetail value, $Res Function(TagDetail) _then) = _$TagDetailCopyWithImpl;
@useResult
$Res call({
 TagInfo tag, List<VerificationEvent> events, NftInfo? nft, SellerInfo? seller
});


$TagInfoCopyWith<$Res> get tag;$NftInfoCopyWith<$Res>? get nft;$SellerInfoCopyWith<$Res>? get seller;

}
/// @nodoc
class _$TagDetailCopyWithImpl<$Res>
    implements $TagDetailCopyWith<$Res> {
  _$TagDetailCopyWithImpl(this._self, this._then);

  final TagDetail _self;
  final $Res Function(TagDetail) _then;

/// Create a copy of TagDetail
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? tag = null,Object? events = null,Object? nft = freezed,Object? seller = freezed,}) {
  return _then(_self.copyWith(
tag: null == tag ? _self.tag : tag // ignore: cast_nullable_to_non_nullable
as TagInfo,events: null == events ? _self.events : events // ignore: cast_nullable_to_non_nullable
as List<VerificationEvent>,nft: freezed == nft ? _self.nft : nft // ignore: cast_nullable_to_non_nullable
as NftInfo?,seller: freezed == seller ? _self.seller : seller // ignore: cast_nullable_to_non_nullable
as SellerInfo?,
  ));
}
/// Create a copy of TagDetail
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$TagInfoCopyWith<$Res> get tag {
  
  return $TagInfoCopyWith<$Res>(_self.tag, (value) {
    return _then(_self.copyWith(tag: value));
  });
}/// Create a copy of TagDetail
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$NftInfoCopyWith<$Res>? get nft {
    if (_self.nft == null) {
    return null;
  }

  return $NftInfoCopyWith<$Res>(_self.nft!, (value) {
    return _then(_self.copyWith(nft: value));
  });
}/// Create a copy of TagDetail
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$SellerInfoCopyWith<$Res>? get seller {
    if (_self.seller == null) {
    return null;
  }

  return $SellerInfoCopyWith<$Res>(_self.seller!, (value) {
    return _then(_self.copyWith(seller: value));
  });
}
}


/// Adds pattern-matching-related methods to [TagDetail].
extension TagDetailPatterns on TagDetail {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _TagDetail value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _TagDetail() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _TagDetail value)  $default,){
final _that = this;
switch (_that) {
case _TagDetail():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _TagDetail value)?  $default,){
final _that = this;
switch (_that) {
case _TagDetail() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( TagInfo tag,  List<VerificationEvent> events,  NftInfo? nft,  SellerInfo? seller)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _TagDetail() when $default != null:
return $default(_that.tag,_that.events,_that.nft,_that.seller);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( TagInfo tag,  List<VerificationEvent> events,  NftInfo? nft,  SellerInfo? seller)  $default,) {final _that = this;
switch (_that) {
case _TagDetail():
return $default(_that.tag,_that.events,_that.nft,_that.seller);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( TagInfo tag,  List<VerificationEvent> events,  NftInfo? nft,  SellerInfo? seller)?  $default,) {final _that = this;
switch (_that) {
case _TagDetail() when $default != null:
return $default(_that.tag,_that.events,_that.nft,_that.seller);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _TagDetail implements TagDetail {
  const _TagDetail({required this.tag, required final  List<VerificationEvent> events, this.nft, this.seller}): _events = events;
  factory _TagDetail.fromJson(Map<String, dynamic> json) => _$TagDetailFromJson(json);

@override final  TagInfo tag;
 final  List<VerificationEvent> _events;
@override List<VerificationEvent> get events {
  if (_events is EqualUnmodifiableListView) return _events;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_events);
}

@override final  NftInfo? nft;
@override final  SellerInfo? seller;

/// Create a copy of TagDetail
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$TagDetailCopyWith<_TagDetail> get copyWith => __$TagDetailCopyWithImpl<_TagDetail>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$TagDetailToJson(this, );
}

@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _TagDetail&&(identical(other.tag, tag) || other.tag == tag)&&const DeepCollectionEquality().equals(other._events, _events)&&(identical(other.nft, nft) || other.nft == nft)&&(identical(other.seller, seller) || other.seller == seller));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,tag,const DeepCollectionEquality().hash(_events),nft,seller);

@override
String toString() {
  return 'TagDetail(tag: $tag, events: $events, nft: $nft, seller: $seller)';
}


}

/// @nodoc
abstract mixin class _$TagDetailCopyWith<$Res> implements $TagDetailCopyWith<$Res> {
  factory _$TagDetailCopyWith(_TagDetail value, $Res Function(_TagDetail) _then) = __$TagDetailCopyWithImpl;
@override @useResult
$Res call({
 TagInfo tag, List<VerificationEvent> events, NftInfo? nft, SellerInfo? seller
});


@override $TagInfoCopyWith<$Res> get tag;@override $NftInfoCopyWith<$Res>? get nft;@override $SellerInfoCopyWith<$Res>? get seller;

}
/// @nodoc
class __$TagDetailCopyWithImpl<$Res>
    implements _$TagDetailCopyWith<$Res> {
  __$TagDetailCopyWithImpl(this._self, this._then);

  final _TagDetail _self;
  final $Res Function(_TagDetail) _then;

/// Create a copy of TagDetail
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? tag = null,Object? events = null,Object? nft = freezed,Object? seller = freezed,}) {
  return _then(_TagDetail(
tag: null == tag ? _self.tag : tag // ignore: cast_nullable_to_non_nullable
as TagInfo,events: null == events ? _self._events : events // ignore: cast_nullable_to_non_nullable
as List<VerificationEvent>,nft: freezed == nft ? _self.nft : nft // ignore: cast_nullable_to_non_nullable
as NftInfo?,seller: freezed == seller ? _self.seller : seller // ignore: cast_nullable_to_non_nullable
as SellerInfo?,
  ));
}

/// Create a copy of TagDetail
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$TagInfoCopyWith<$Res> get tag {
  
  return $TagInfoCopyWith<$Res>(_self.tag, (value) {
    return _then(_self.copyWith(tag: value));
  });
}/// Create a copy of TagDetail
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$NftInfoCopyWith<$Res>? get nft {
    if (_self.nft == null) {
    return null;
  }

  return $NftInfoCopyWith<$Res>(_self.nft!, (value) {
    return _then(_self.copyWith(nft: value));
  });
}/// Create a copy of TagDetail
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$SellerInfoCopyWith<$Res>? get seller {
    if (_self.seller == null) {
    return null;
  }

  return $SellerInfoCopyWith<$Res>(_self.seller!, (value) {
    return _then(_self.copyWith(seller: value));
  });
}
}


/// @nodoc
mixin _$TagInfo {

 String get id; String get tagUid; String? get itemId; String? get sellerId; String get status; int? get sunCounter; String? get activatedAt;
/// Create a copy of TagInfo
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$TagInfoCopyWith<TagInfo> get copyWith => _$TagInfoCopyWithImpl<TagInfo>(this as TagInfo, _$identity);

  /// Serializes this TagInfo to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is TagInfo&&(identical(other.id, id) || other.id == id)&&(identical(other.tagUid, tagUid) || other.tagUid == tagUid)&&(identical(other.itemId, itemId) || other.itemId == itemId)&&(identical(other.sellerId, sellerId) || other.sellerId == sellerId)&&(identical(other.status, status) || other.status == status)&&(identical(other.sunCounter, sunCounter) || other.sunCounter == sunCounter)&&(identical(other.activatedAt, activatedAt) || other.activatedAt == activatedAt));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,id,tagUid,itemId,sellerId,status,sunCounter,activatedAt);

@override
String toString() {
  return 'TagInfo(id: $id, tagUid: $tagUid, itemId: $itemId, sellerId: $sellerId, status: $status, sunCounter: $sunCounter, activatedAt: $activatedAt)';
}


}

/// @nodoc
abstract mixin class $TagInfoCopyWith<$Res>  {
  factory $TagInfoCopyWith(TagInfo value, $Res Function(TagInfo) _then) = _$TagInfoCopyWithImpl;
@useResult
$Res call({
 String id, String tagUid, String? itemId, String? sellerId, String status, int? sunCounter, String? activatedAt
});




}
/// @nodoc
class _$TagInfoCopyWithImpl<$Res>
    implements $TagInfoCopyWith<$Res> {
  _$TagInfoCopyWithImpl(this._self, this._then);

  final TagInfo _self;
  final $Res Function(TagInfo) _then;

/// Create a copy of TagInfo
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? tagUid = null,Object? itemId = freezed,Object? sellerId = freezed,Object? status = null,Object? sunCounter = freezed,Object? activatedAt = freezed,}) {
  return _then(_self.copyWith(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,tagUid: null == tagUid ? _self.tagUid : tagUid // ignore: cast_nullable_to_non_nullable
as String,itemId: freezed == itemId ? _self.itemId : itemId // ignore: cast_nullable_to_non_nullable
as String?,sellerId: freezed == sellerId ? _self.sellerId : sellerId // ignore: cast_nullable_to_non_nullable
as String?,status: null == status ? _self.status : status // ignore: cast_nullable_to_non_nullable
as String,sunCounter: freezed == sunCounter ? _self.sunCounter : sunCounter // ignore: cast_nullable_to_non_nullable
as int?,activatedAt: freezed == activatedAt ? _self.activatedAt : activatedAt // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}

}


/// Adds pattern-matching-related methods to [TagInfo].
extension TagInfoPatterns on TagInfo {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _TagInfo value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _TagInfo() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _TagInfo value)  $default,){
final _that = this;
switch (_that) {
case _TagInfo():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _TagInfo value)?  $default,){
final _that = this;
switch (_that) {
case _TagInfo() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String id,  String tagUid,  String? itemId,  String? sellerId,  String status,  int? sunCounter,  String? activatedAt)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _TagInfo() when $default != null:
return $default(_that.id,_that.tagUid,_that.itemId,_that.sellerId,_that.status,_that.sunCounter,_that.activatedAt);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String id,  String tagUid,  String? itemId,  String? sellerId,  String status,  int? sunCounter,  String? activatedAt)  $default,) {final _that = this;
switch (_that) {
case _TagInfo():
return $default(_that.id,_that.tagUid,_that.itemId,_that.sellerId,_that.status,_that.sunCounter,_that.activatedAt);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String id,  String tagUid,  String? itemId,  String? sellerId,  String status,  int? sunCounter,  String? activatedAt)?  $default,) {final _that = this;
switch (_that) {
case _TagInfo() when $default != null:
return $default(_that.id,_that.tagUid,_that.itemId,_that.sellerId,_that.status,_that.sunCounter,_that.activatedAt);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _TagInfo implements TagInfo {
  const _TagInfo({required this.id, required this.tagUid, this.itemId, this.sellerId, required this.status, this.sunCounter, this.activatedAt});
  factory _TagInfo.fromJson(Map<String, dynamic> json) => _$TagInfoFromJson(json);

@override final  String id;
@override final  String tagUid;
@override final  String? itemId;
@override final  String? sellerId;
@override final  String status;
@override final  int? sunCounter;
@override final  String? activatedAt;

/// Create a copy of TagInfo
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$TagInfoCopyWith<_TagInfo> get copyWith => __$TagInfoCopyWithImpl<_TagInfo>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$TagInfoToJson(this, );
}

@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _TagInfo&&(identical(other.id, id) || other.id == id)&&(identical(other.tagUid, tagUid) || other.tagUid == tagUid)&&(identical(other.itemId, itemId) || other.itemId == itemId)&&(identical(other.sellerId, sellerId) || other.sellerId == sellerId)&&(identical(other.status, status) || other.status == status)&&(identical(other.sunCounter, sunCounter) || other.sunCounter == sunCounter)&&(identical(other.activatedAt, activatedAt) || other.activatedAt == activatedAt));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,id,tagUid,itemId,sellerId,status,sunCounter,activatedAt);

@override
String toString() {
  return 'TagInfo(id: $id, tagUid: $tagUid, itemId: $itemId, sellerId: $sellerId, status: $status, sunCounter: $sunCounter, activatedAt: $activatedAt)';
}


}

/// @nodoc
abstract mixin class _$TagInfoCopyWith<$Res> implements $TagInfoCopyWith<$Res> {
  factory _$TagInfoCopyWith(_TagInfo value, $Res Function(_TagInfo) _then) = __$TagInfoCopyWithImpl;
@override @useResult
$Res call({
 String id, String tagUid, String? itemId, String? sellerId, String status, int? sunCounter, String? activatedAt
});




}
/// @nodoc
class __$TagInfoCopyWithImpl<$Res>
    implements _$TagInfoCopyWith<$Res> {
  __$TagInfoCopyWithImpl(this._self, this._then);

  final _TagInfo _self;
  final $Res Function(_TagInfo) _then;

/// Create a copy of TagInfo
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? tagUid = null,Object? itemId = freezed,Object? sellerId = freezed,Object? status = null,Object? sunCounter = freezed,Object? activatedAt = freezed,}) {
  return _then(_TagInfo(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,tagUid: null == tagUid ? _self.tagUid : tagUid // ignore: cast_nullable_to_non_nullable
as String,itemId: freezed == itemId ? _self.itemId : itemId // ignore: cast_nullable_to_non_nullable
as String?,sellerId: freezed == sellerId ? _self.sellerId : sellerId // ignore: cast_nullable_to_non_nullable
as String?,status: null == status ? _self.status : status // ignore: cast_nullable_to_non_nullable
as String,sunCounter: freezed == sunCounter ? _self.sunCounter : sunCounter // ignore: cast_nullable_to_non_nullable
as int?,activatedAt: freezed == activatedAt ? _self.activatedAt : activatedAt // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}


}


/// @nodoc
mixin _$VerificationEvent {

 String get scanType; bool get cmacValid; String get createdAt; String? get videoProofStatus;
/// Create a copy of VerificationEvent
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$VerificationEventCopyWith<VerificationEvent> get copyWith => _$VerificationEventCopyWithImpl<VerificationEvent>(this as VerificationEvent, _$identity);

  /// Serializes this VerificationEvent to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is VerificationEvent&&(identical(other.scanType, scanType) || other.scanType == scanType)&&(identical(other.cmacValid, cmacValid) || other.cmacValid == cmacValid)&&(identical(other.createdAt, createdAt) || other.createdAt == createdAt)&&(identical(other.videoProofStatus, videoProofStatus) || other.videoProofStatus == videoProofStatus));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,scanType,cmacValid,createdAt,videoProofStatus);

@override
String toString() {
  return 'VerificationEvent(scanType: $scanType, cmacValid: $cmacValid, createdAt: $createdAt, videoProofStatus: $videoProofStatus)';
}


}

/// @nodoc
abstract mixin class $VerificationEventCopyWith<$Res>  {
  factory $VerificationEventCopyWith(VerificationEvent value, $Res Function(VerificationEvent) _then) = _$VerificationEventCopyWithImpl;
@useResult
$Res call({
 String scanType, bool cmacValid, String createdAt, String? videoProofStatus
});




}
/// @nodoc
class _$VerificationEventCopyWithImpl<$Res>
    implements $VerificationEventCopyWith<$Res> {
  _$VerificationEventCopyWithImpl(this._self, this._then);

  final VerificationEvent _self;
  final $Res Function(VerificationEvent) _then;

/// Create a copy of VerificationEvent
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? scanType = null,Object? cmacValid = null,Object? createdAt = null,Object? videoProofStatus = freezed,}) {
  return _then(_self.copyWith(
scanType: null == scanType ? _self.scanType : scanType // ignore: cast_nullable_to_non_nullable
as String,cmacValid: null == cmacValid ? _self.cmacValid : cmacValid // ignore: cast_nullable_to_non_nullable
as bool,createdAt: null == createdAt ? _self.createdAt : createdAt // ignore: cast_nullable_to_non_nullable
as String,videoProofStatus: freezed == videoProofStatus ? _self.videoProofStatus : videoProofStatus // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}

}


/// Adds pattern-matching-related methods to [VerificationEvent].
extension VerificationEventPatterns on VerificationEvent {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _VerificationEvent value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _VerificationEvent() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _VerificationEvent value)  $default,){
final _that = this;
switch (_that) {
case _VerificationEvent():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _VerificationEvent value)?  $default,){
final _that = this;
switch (_that) {
case _VerificationEvent() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String scanType,  bool cmacValid,  String createdAt,  String? videoProofStatus)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _VerificationEvent() when $default != null:
return $default(_that.scanType,_that.cmacValid,_that.createdAt,_that.videoProofStatus);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String scanType,  bool cmacValid,  String createdAt,  String? videoProofStatus)  $default,) {final _that = this;
switch (_that) {
case _VerificationEvent():
return $default(_that.scanType,_that.cmacValid,_that.createdAt,_that.videoProofStatus);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String scanType,  bool cmacValid,  String createdAt,  String? videoProofStatus)?  $default,) {final _that = this;
switch (_that) {
case _VerificationEvent() when $default != null:
return $default(_that.scanType,_that.cmacValid,_that.createdAt,_that.videoProofStatus);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _VerificationEvent implements VerificationEvent {
  const _VerificationEvent({required this.scanType, required this.cmacValid, required this.createdAt, this.videoProofStatus});
  factory _VerificationEvent.fromJson(Map<String, dynamic> json) => _$VerificationEventFromJson(json);

@override final  String scanType;
@override final  bool cmacValid;
@override final  String createdAt;
@override final  String? videoProofStatus;

/// Create a copy of VerificationEvent
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$VerificationEventCopyWith<_VerificationEvent> get copyWith => __$VerificationEventCopyWithImpl<_VerificationEvent>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$VerificationEventToJson(this, );
}

@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _VerificationEvent&&(identical(other.scanType, scanType) || other.scanType == scanType)&&(identical(other.cmacValid, cmacValid) || other.cmacValid == cmacValid)&&(identical(other.createdAt, createdAt) || other.createdAt == createdAt)&&(identical(other.videoProofStatus, videoProofStatus) || other.videoProofStatus == videoProofStatus));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,scanType,cmacValid,createdAt,videoProofStatus);

@override
String toString() {
  return 'VerificationEvent(scanType: $scanType, cmacValid: $cmacValid, createdAt: $createdAt, videoProofStatus: $videoProofStatus)';
}


}

/// @nodoc
abstract mixin class _$VerificationEventCopyWith<$Res> implements $VerificationEventCopyWith<$Res> {
  factory _$VerificationEventCopyWith(_VerificationEvent value, $Res Function(_VerificationEvent) _then) = __$VerificationEventCopyWithImpl;
@override @useResult
$Res call({
 String scanType, bool cmacValid, String createdAt, String? videoProofStatus
});




}
/// @nodoc
class __$VerificationEventCopyWithImpl<$Res>
    implements _$VerificationEventCopyWith<$Res> {
  __$VerificationEventCopyWithImpl(this._self, this._then);

  final _VerificationEvent _self;
  final $Res Function(_VerificationEvent) _then;

/// Create a copy of VerificationEvent
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? scanType = null,Object? cmacValid = null,Object? createdAt = null,Object? videoProofStatus = freezed,}) {
  return _then(_VerificationEvent(
scanType: null == scanType ? _self.scanType : scanType // ignore: cast_nullable_to_non_nullable
as String,cmacValid: null == cmacValid ? _self.cmacValid : cmacValid // ignore: cast_nullable_to_non_nullable
as bool,createdAt: null == createdAt ? _self.createdAt : createdAt // ignore: cast_nullable_to_non_nullable
as String,videoProofStatus: freezed == videoProofStatus ? _self.videoProofStatus : videoProofStatus // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}


}


/// @nodoc
mixin _$NftInfo {

 String get chain; String get contractAddress; String? get tokenId; String? get mintTxHash; String? get metadataUri;
/// Create a copy of NftInfo
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$NftInfoCopyWith<NftInfo> get copyWith => _$NftInfoCopyWithImpl<NftInfo>(this as NftInfo, _$identity);

  /// Serializes this NftInfo to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is NftInfo&&(identical(other.chain, chain) || other.chain == chain)&&(identical(other.contractAddress, contractAddress) || other.contractAddress == contractAddress)&&(identical(other.tokenId, tokenId) || other.tokenId == tokenId)&&(identical(other.mintTxHash, mintTxHash) || other.mintTxHash == mintTxHash)&&(identical(other.metadataUri, metadataUri) || other.metadataUri == metadataUri));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,chain,contractAddress,tokenId,mintTxHash,metadataUri);

@override
String toString() {
  return 'NftInfo(chain: $chain, contractAddress: $contractAddress, tokenId: $tokenId, mintTxHash: $mintTxHash, metadataUri: $metadataUri)';
}


}

/// @nodoc
abstract mixin class $NftInfoCopyWith<$Res>  {
  factory $NftInfoCopyWith(NftInfo value, $Res Function(NftInfo) _then) = _$NftInfoCopyWithImpl;
@useResult
$Res call({
 String chain, String contractAddress, String? tokenId, String? mintTxHash, String? metadataUri
});




}
/// @nodoc
class _$NftInfoCopyWithImpl<$Res>
    implements $NftInfoCopyWith<$Res> {
  _$NftInfoCopyWithImpl(this._self, this._then);

  final NftInfo _self;
  final $Res Function(NftInfo) _then;

/// Create a copy of NftInfo
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? chain = null,Object? contractAddress = null,Object? tokenId = freezed,Object? mintTxHash = freezed,Object? metadataUri = freezed,}) {
  return _then(_self.copyWith(
chain: null == chain ? _self.chain : chain // ignore: cast_nullable_to_non_nullable
as String,contractAddress: null == contractAddress ? _self.contractAddress : contractAddress // ignore: cast_nullable_to_non_nullable
as String,tokenId: freezed == tokenId ? _self.tokenId : tokenId // ignore: cast_nullable_to_non_nullable
as String?,mintTxHash: freezed == mintTxHash ? _self.mintTxHash : mintTxHash // ignore: cast_nullable_to_non_nullable
as String?,metadataUri: freezed == metadataUri ? _self.metadataUri : metadataUri // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}

}


/// Adds pattern-matching-related methods to [NftInfo].
extension NftInfoPatterns on NftInfo {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _NftInfo value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _NftInfo() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _NftInfo value)  $default,){
final _that = this;
switch (_that) {
case _NftInfo():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _NftInfo value)?  $default,){
final _that = this;
switch (_that) {
case _NftInfo() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String chain,  String contractAddress,  String? tokenId,  String? mintTxHash,  String? metadataUri)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _NftInfo() when $default != null:
return $default(_that.chain,_that.contractAddress,_that.tokenId,_that.mintTxHash,_that.metadataUri);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String chain,  String contractAddress,  String? tokenId,  String? mintTxHash,  String? metadataUri)  $default,) {final _that = this;
switch (_that) {
case _NftInfo():
return $default(_that.chain,_that.contractAddress,_that.tokenId,_that.mintTxHash,_that.metadataUri);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String chain,  String contractAddress,  String? tokenId,  String? mintTxHash,  String? metadataUri)?  $default,) {final _that = this;
switch (_that) {
case _NftInfo() when $default != null:
return $default(_that.chain,_that.contractAddress,_that.tokenId,_that.mintTxHash,_that.metadataUri);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _NftInfo implements NftInfo {
  const _NftInfo({required this.chain, required this.contractAddress, this.tokenId, this.mintTxHash, this.metadataUri});
  factory _NftInfo.fromJson(Map<String, dynamic> json) => _$NftInfoFromJson(json);

@override final  String chain;
@override final  String contractAddress;
@override final  String? tokenId;
@override final  String? mintTxHash;
@override final  String? metadataUri;

/// Create a copy of NftInfo
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$NftInfoCopyWith<_NftInfo> get copyWith => __$NftInfoCopyWithImpl<_NftInfo>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$NftInfoToJson(this, );
}

@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _NftInfo&&(identical(other.chain, chain) || other.chain == chain)&&(identical(other.contractAddress, contractAddress) || other.contractAddress == contractAddress)&&(identical(other.tokenId, tokenId) || other.tokenId == tokenId)&&(identical(other.mintTxHash, mintTxHash) || other.mintTxHash == mintTxHash)&&(identical(other.metadataUri, metadataUri) || other.metadataUri == metadataUri));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,chain,contractAddress,tokenId,mintTxHash,metadataUri);

@override
String toString() {
  return 'NftInfo(chain: $chain, contractAddress: $contractAddress, tokenId: $tokenId, mintTxHash: $mintTxHash, metadataUri: $metadataUri)';
}


}

/// @nodoc
abstract mixin class _$NftInfoCopyWith<$Res> implements $NftInfoCopyWith<$Res> {
  factory _$NftInfoCopyWith(_NftInfo value, $Res Function(_NftInfo) _then) = __$NftInfoCopyWithImpl;
@override @useResult
$Res call({
 String chain, String contractAddress, String? tokenId, String? mintTxHash, String? metadataUri
});




}
/// @nodoc
class __$NftInfoCopyWithImpl<$Res>
    implements _$NftInfoCopyWith<$Res> {
  __$NftInfoCopyWithImpl(this._self, this._then);

  final _NftInfo _self;
  final $Res Function(_NftInfo) _then;

/// Create a copy of NftInfo
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? chain = null,Object? contractAddress = null,Object? tokenId = freezed,Object? mintTxHash = freezed,Object? metadataUri = freezed,}) {
  return _then(_NftInfo(
chain: null == chain ? _self.chain : chain // ignore: cast_nullable_to_non_nullable
as String,contractAddress: null == contractAddress ? _self.contractAddress : contractAddress // ignore: cast_nullable_to_non_nullable
as String,tokenId: freezed == tokenId ? _self.tokenId : tokenId // ignore: cast_nullable_to_non_nullable
as String?,mintTxHash: freezed == mintTxHash ? _self.mintTxHash : mintTxHash // ignore: cast_nullable_to_non_nullable
as String?,metadataUri: freezed == metadataUri ? _self.metadataUri : metadataUri // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}


}


/// @nodoc
mixin _$SellerInfo {

 String? get username;
/// Create a copy of SellerInfo
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$SellerInfoCopyWith<SellerInfo> get copyWith => _$SellerInfoCopyWithImpl<SellerInfo>(this as SellerInfo, _$identity);

  /// Serializes this SellerInfo to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is SellerInfo&&(identical(other.username, username) || other.username == username));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,username);

@override
String toString() {
  return 'SellerInfo(username: $username)';
}


}

/// @nodoc
abstract mixin class $SellerInfoCopyWith<$Res>  {
  factory $SellerInfoCopyWith(SellerInfo value, $Res Function(SellerInfo) _then) = _$SellerInfoCopyWithImpl;
@useResult
$Res call({
 String? username
});




}
/// @nodoc
class _$SellerInfoCopyWithImpl<$Res>
    implements $SellerInfoCopyWith<$Res> {
  _$SellerInfoCopyWithImpl(this._self, this._then);

  final SellerInfo _self;
  final $Res Function(SellerInfo) _then;

/// Create a copy of SellerInfo
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? username = freezed,}) {
  return _then(_self.copyWith(
username: freezed == username ? _self.username : username // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}

}


/// Adds pattern-matching-related methods to [SellerInfo].
extension SellerInfoPatterns on SellerInfo {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _SellerInfo value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _SellerInfo() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _SellerInfo value)  $default,){
final _that = this;
switch (_that) {
case _SellerInfo():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _SellerInfo value)?  $default,){
final _that = this;
switch (_that) {
case _SellerInfo() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String? username)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _SellerInfo() when $default != null:
return $default(_that.username);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String? username)  $default,) {final _that = this;
switch (_that) {
case _SellerInfo():
return $default(_that.username);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String? username)?  $default,) {final _that = this;
switch (_that) {
case _SellerInfo() when $default != null:
return $default(_that.username);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _SellerInfo implements SellerInfo {
  const _SellerInfo({this.username});
  factory _SellerInfo.fromJson(Map<String, dynamic> json) => _$SellerInfoFromJson(json);

@override final  String? username;

/// Create a copy of SellerInfo
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$SellerInfoCopyWith<_SellerInfo> get copyWith => __$SellerInfoCopyWithImpl<_SellerInfo>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$SellerInfoToJson(this, );
}

@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _SellerInfo&&(identical(other.username, username) || other.username == username));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,username);

@override
String toString() {
  return 'SellerInfo(username: $username)';
}


}

/// @nodoc
abstract mixin class _$SellerInfoCopyWith<$Res> implements $SellerInfoCopyWith<$Res> {
  factory _$SellerInfoCopyWith(_SellerInfo value, $Res Function(_SellerInfo) _then) = __$SellerInfoCopyWithImpl;
@override @useResult
$Res call({
 String? username
});




}
/// @nodoc
class __$SellerInfoCopyWithImpl<$Res>
    implements _$SellerInfoCopyWith<$Res> {
  __$SellerInfoCopyWithImpl(this._self, this._then);

  final _SellerInfo _self;
  final $Res Function(_SellerInfo) _then;

/// Create a copy of SellerInfo
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? username = freezed,}) {
  return _then(_SellerInfo(
username: freezed == username ? _self.username : username // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}


}

// dart format on
