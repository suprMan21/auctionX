// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'mint_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;
/// @nodoc
mixin _$MintState {





@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is MintState);
}


@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
  return 'MintState()';
}


}

/// @nodoc
class $MintStateCopyWith<$Res>  {
$MintStateCopyWith(MintState _, $Res Function(MintState) __);
}


/// Adds pattern-matching-related methods to [MintState].
extension MintStatePatterns on MintState {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>({TResult Function( _Idle value)?  idle,TResult Function( _PreparingMetadata value)?  preparingMetadata,TResult Function( _SubmittingTransaction value)?  submittingTransaction,TResult Function( _WaitingConfirmation value)?  waitingConfirmation,TResult Function( _Success value)?  success,TResult Function( _Error value)?  error,TResult Function( _Timeout value)?  timeout,required TResult orElse(),}){
final _that = this;
switch (_that) {
case _Idle() when idle != null:
return idle(_that);case _PreparingMetadata() when preparingMetadata != null:
return preparingMetadata(_that);case _SubmittingTransaction() when submittingTransaction != null:
return submittingTransaction(_that);case _WaitingConfirmation() when waitingConfirmation != null:
return waitingConfirmation(_that);case _Success() when success != null:
return success(_that);case _Error() when error != null:
return error(_that);case _Timeout() when timeout != null:
return timeout(_that);case _:
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

@optionalTypeArgs TResult map<TResult extends Object?>({required TResult Function( _Idle value)  idle,required TResult Function( _PreparingMetadata value)  preparingMetadata,required TResult Function( _SubmittingTransaction value)  submittingTransaction,required TResult Function( _WaitingConfirmation value)  waitingConfirmation,required TResult Function( _Success value)  success,required TResult Function( _Error value)  error,required TResult Function( _Timeout value)  timeout,}){
final _that = this;
switch (_that) {
case _Idle():
return idle(_that);case _PreparingMetadata():
return preparingMetadata(_that);case _SubmittingTransaction():
return submittingTransaction(_that);case _WaitingConfirmation():
return waitingConfirmation(_that);case _Success():
return success(_that);case _Error():
return error(_that);case _Timeout():
return timeout(_that);case _:
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>({TResult? Function( _Idle value)?  idle,TResult? Function( _PreparingMetadata value)?  preparingMetadata,TResult? Function( _SubmittingTransaction value)?  submittingTransaction,TResult? Function( _WaitingConfirmation value)?  waitingConfirmation,TResult? Function( _Success value)?  success,TResult? Function( _Error value)?  error,TResult? Function( _Timeout value)?  timeout,}){
final _that = this;
switch (_that) {
case _Idle() when idle != null:
return idle(_that);case _PreparingMetadata() when preparingMetadata != null:
return preparingMetadata(_that);case _SubmittingTransaction() when submittingTransaction != null:
return submittingTransaction(_that);case _WaitingConfirmation() when waitingConfirmation != null:
return waitingConfirmation(_that);case _Success() when success != null:
return success(_that);case _Error() when error != null:
return error(_that);case _Timeout() when timeout != null:
return timeout(_that);case _:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>({TResult Function()?  idle,TResult Function()?  preparingMetadata,TResult Function()?  submittingTransaction,TResult Function()?  waitingConfirmation,TResult Function( MintResult result)?  success,TResult Function( String message)?  error,TResult Function()?  timeout,required TResult orElse(),}) {final _that = this;
switch (_that) {
case _Idle() when idle != null:
return idle();case _PreparingMetadata() when preparingMetadata != null:
return preparingMetadata();case _SubmittingTransaction() when submittingTransaction != null:
return submittingTransaction();case _WaitingConfirmation() when waitingConfirmation != null:
return waitingConfirmation();case _Success() when success != null:
return success(_that.result);case _Error() when error != null:
return error(_that.message);case _Timeout() when timeout != null:
return timeout();case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>({required TResult Function()  idle,required TResult Function()  preparingMetadata,required TResult Function()  submittingTransaction,required TResult Function()  waitingConfirmation,required TResult Function( MintResult result)  success,required TResult Function( String message)  error,required TResult Function()  timeout,}) {final _that = this;
switch (_that) {
case _Idle():
return idle();case _PreparingMetadata():
return preparingMetadata();case _SubmittingTransaction():
return submittingTransaction();case _WaitingConfirmation():
return waitingConfirmation();case _Success():
return success(_that.result);case _Error():
return error(_that.message);case _Timeout():
return timeout();case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>({TResult? Function()?  idle,TResult? Function()?  preparingMetadata,TResult? Function()?  submittingTransaction,TResult? Function()?  waitingConfirmation,TResult? Function( MintResult result)?  success,TResult? Function( String message)?  error,TResult? Function()?  timeout,}) {final _that = this;
switch (_that) {
case _Idle() when idle != null:
return idle();case _PreparingMetadata() when preparingMetadata != null:
return preparingMetadata();case _SubmittingTransaction() when submittingTransaction != null:
return submittingTransaction();case _WaitingConfirmation() when waitingConfirmation != null:
return waitingConfirmation();case _Success() when success != null:
return success(_that.result);case _Error() when error != null:
return error(_that.message);case _Timeout() when timeout != null:
return timeout();case _:
  return null;

}
}

}

/// @nodoc


class _Idle implements MintState {
  const _Idle();
  






@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _Idle);
}


@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
  return 'MintState.idle()';
}


}




/// @nodoc


class _PreparingMetadata implements MintState {
  const _PreparingMetadata();
  






@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _PreparingMetadata);
}


@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
  return 'MintState.preparingMetadata()';
}


}




/// @nodoc


class _SubmittingTransaction implements MintState {
  const _SubmittingTransaction();
  






@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _SubmittingTransaction);
}


@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
  return 'MintState.submittingTransaction()';
}


}




/// @nodoc


class _WaitingConfirmation implements MintState {
  const _WaitingConfirmation();
  






@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _WaitingConfirmation);
}


@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
  return 'MintState.waitingConfirmation()';
}


}




/// @nodoc


class _Success implements MintState {
  const _Success(this.result);
  

 final  MintResult result;

/// Create a copy of MintState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$SuccessCopyWith<_Success> get copyWith => __$SuccessCopyWithImpl<_Success>(this, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _Success&&(identical(other.result, result) || other.result == result));
}


@override
int get hashCode => Object.hash(runtimeType,result);

@override
String toString() {
  return 'MintState.success(result: $result)';
}


}

/// @nodoc
abstract mixin class _$SuccessCopyWith<$Res> implements $MintStateCopyWith<$Res> {
  factory _$SuccessCopyWith(_Success value, $Res Function(_Success) _then) = __$SuccessCopyWithImpl;
@useResult
$Res call({
 MintResult result
});


$MintResultCopyWith<$Res> get result;

}
/// @nodoc
class __$SuccessCopyWithImpl<$Res>
    implements _$SuccessCopyWith<$Res> {
  __$SuccessCopyWithImpl(this._self, this._then);

  final _Success _self;
  final $Res Function(_Success) _then;

/// Create a copy of MintState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? result = null,}) {
  return _then(_Success(
null == result ? _self.result : result // ignore: cast_nullable_to_non_nullable
as MintResult,
  ));
}

/// Create a copy of MintState
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$MintResultCopyWith<$Res> get result {
  
  return $MintResultCopyWith<$Res>(_self.result, (value) {
    return _then(_self.copyWith(result: value));
  });
}
}

/// @nodoc


class _Error implements MintState {
  const _Error(this.message);
  

 final  String message;

/// Create a copy of MintState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$ErrorCopyWith<_Error> get copyWith => __$ErrorCopyWithImpl<_Error>(this, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _Error&&(identical(other.message, message) || other.message == message));
}


@override
int get hashCode => Object.hash(runtimeType,message);

@override
String toString() {
  return 'MintState.error(message: $message)';
}


}

/// @nodoc
abstract mixin class _$ErrorCopyWith<$Res> implements $MintStateCopyWith<$Res> {
  factory _$ErrorCopyWith(_Error value, $Res Function(_Error) _then) = __$ErrorCopyWithImpl;
@useResult
$Res call({
 String message
});




}
/// @nodoc
class __$ErrorCopyWithImpl<$Res>
    implements _$ErrorCopyWith<$Res> {
  __$ErrorCopyWithImpl(this._self, this._then);

  final _Error _self;
  final $Res Function(_Error) _then;

/// Create a copy of MintState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? message = null,}) {
  return _then(_Error(
null == message ? _self.message : message // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

/// @nodoc


class _Timeout implements MintState {
  const _Timeout();
  






@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _Timeout);
}


@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
  return 'MintState.timeout()';
}


}




// dart format on
