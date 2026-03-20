import 'package:dartz/dartz.dart';
import '../../../../core/errors/failures.dart';
import '../entities/mint_result.dart';

abstract class MintRepository {
  Future<Either<Failure, MintResult>> mintVerification({
    required String tagId,
  });
}
