import 'package:dartz/dartz.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show AuthException;
import '../../../../core/errors/failures.dart';
import '../../domain/entities/user_entity.dart';
import '../../domain/repositories/auth_repository.dart';
import '../datasources/supabase_auth_datasource.dart';

class AuthRepositoryImpl implements AuthRepository {
  final SupabaseAuthDatasource _datasource;

  AuthRepositoryImpl(this._datasource);

  @override
  Future<Either<Failure, UserEntity>> signIn({
    required String email,
    required String password,
  }) async {
    try {
      final user = await _datasource.signIn(email: email, password: password);
      return Right(user);
    } on AuthException catch (e) {
      return Left(AuthFailure(e.message));
    } catch (e) {
      return Left(ServerFailure(e.toString()));
    }
  }

  @override
  Future<Either<Failure, UserEntity>> signUp({
    required String email,
    required String password,
  }) async {
    try {
      final user = await _datasource.signUp(email: email, password: password);
      return Right(user);
    } on AuthException catch (e) {
      return Left(AuthFailure(e.message));
    } catch (e) {
      return Left(ServerFailure(e.toString()));
    }
  }

  @override
  Future<Either<Failure, void>> signOut() async {
    try {
      await _datasource.signOut();
      return const Right(null);
    } catch (e) {
      return Left(ServerFailure(e.toString()));
    }
  }

  @override
  Future<Either<Failure, void>> resetPassword({required String email}) async {
    try {
      await _datasource.resetPassword(email: email);
      return const Right(null);
    } on AuthException catch (e) {
      return Left(AuthFailure(e.message));
    } catch (e) {
      return Left(ServerFailure(e.toString()));
    }
  }

  @override
  Stream<UserEntity?> authStateChanges() => _datasource.authStateChanges();

  @override
  Future<UserEntity?> getCurrentUser() => _datasource.getCurrentUser();
}
