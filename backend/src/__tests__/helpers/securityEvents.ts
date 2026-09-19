import { vi, type MockInstance } from 'vitest';

/**
 * Captures the security-event lines a test emits.
 *
 * `emitSecurityEvent` writes one JSON line to stdout by design, so reading the
 * emitted events means spying on `console.log`. Centralised here so the spy is
 * typed once rather than re-derived (as implicit `any`) in every spec file.
 */

export type EmittedEvent = Record<string, unknown>;

export interface SecurityEventSpy {
  readonly spy: MockInstance<(...args: unknown[]) => void>;
  /** Every well-formed security event emitted so far. */
  all(): EmittedEvent[];
  /** Events matching one catalog name, in emission order. */
  named(name: string): EmittedEvent[];
  /** Everything emitted, as one string — for redaction assertions. */
  blob(): string;
  clear(): void;
  restore(): void;
}

export const spyOnSecurityEvents = (): SecurityEventSpy => {
  const spy = vi
    .spyOn(console, 'log')
    .mockImplementation(() => {}) as unknown as MockInstance<(...args: unknown[]) => void>;

  const all = (): EmittedEvent[] =>
    spy.mock.calls
      .map((args: unknown[]): EmittedEvent | null => {
        try {
          const parsed: unknown = JSON.parse(String(args[0]));
          return parsed && typeof parsed === 'object' ? (parsed as EmittedEvent) : null;
        } catch {
          // Non-JSON stdout (dotenv banners, stray logs) is not an event.
          return null;
        }
      })
      .filter((e): e is EmittedEvent => e !== null && 'schema' in e);

  return {
    spy,
    all,
    named: (name: string) => all().filter((e) => e.event === name),
    blob: () => JSON.stringify(all()),
    clear: () => spy.mockClear(),
    restore: () => spy.mockRestore(),
  };
};
