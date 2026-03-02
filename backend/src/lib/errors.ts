export type ErrorCode =
  | "invalid_argument"
  | "unauthenticated"
  | "permission_denied"
  | "not_found"
  | "conflict"
  | "failed_precondition"
  | "resource_exhausted"
  | "internal"
  | "unavailable";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = mapCodeToStatus(code);
    this.details = details;
    this.name = 'AppError';
  }
}

export function mapCodeToStatus(code: ErrorCode): number {
  switch (code) {
    case "invalid_argument":
      return 400;
    case "unauthenticated":
      return 401;
    case "permission_denied":
      return 403;
    case "not_found":
      return 404;
    case "conflict":
      return 409;
    case "failed_precondition":
      return 412;
    case "resource_exhausted":
      return 429;
    case "unavailable":
      return 503;
    case "internal":
    default:
      return 500;
  }
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  const anyErr = err as any;
  if (anyErr?.name === "ZodError") {
    return new AppError(
      "invalid_argument",
      "Validation failed",
      anyErr?.issues ?? anyErr
    );
  }

  if (err instanceof Error) {
    return new AppError("internal", err.message);
  }

  return new AppError("internal", "Unknown error");
}
