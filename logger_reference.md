/**
 * Structured logging for Cloud Logging.
 * - No extra deps. Cloud Functions captures console output automatically.
 * - Emit JSON so logs are queryable and can power log-based metrics/alerts.
 */

export type LogLevel = "DEBUG" | "INFO" | "WARNING" | "ERROR";

export type LogContext = {
  requestId?: string | null;
  route?: string | null;
};

export type LogFields = Record<string, unknown>;

function emit(level: LogLevel, message: string, fields?: LogFields, ctx?: LogContext): void {
  const payload = {
    severity: level,
    message,
    requestId: ctx?.requestId ?? null,
    route: ctx?.route ?? null,
    ...(fields ?? {}),
    ts: new Date().toISOString(),
  };

  if (level === "ERROR") console.error(JSON.stringify(payload));
  else if (level === "WARNING") console.warn(JSON.stringify(payload));
  else console.log(JSON.stringify(payload));
}

/**
 * Default logger (no context).
 * Use `withLogContext({ requestId, route })` inside handlers/middleware to attach correlation.
 */
export const log = {
  debug: (message: string, fields?: LogFields) => emit("DEBUG", message, fields),
  info: (message: string, fields?: LogFields) => emit("INFO", message, fields),
  warn: (message: string, fields?: LogFields) => emit("WARNING", message, fields),
  error: (message: string, fields?: LogFields) => emit("ERROR", message, fields),
};

/**
 * Context-bound logger for request correlation.
 */
export function withLogContext(ctx: LogContext) {
  return {
    debug: (message: string, fields?: LogFields) => emit("DEBUG", message, fields, ctx),
    info: (message: string, fields?: LogFields) => emit("INFO", message, fields, ctx),
    warn: (message: string, fields?: LogFields) => emit("WARNING", message, fields, ctx),
    error: (message: string, fields?: LogFields) => emit("ERROR", message, fields, ctx),
  };
}
