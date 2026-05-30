/**
 * NotImplementedError — thrown by LiveYotiClient methods until S22.5 wires the
 * real Yoti SDK. A misconfigured prod deploy that ships `YOTI_CLIENT_MODE=live`
 * before sandbox creds exist will fail LOUDLY here, not silently bill Yoti or
 * leak unverified-session URLs.
 */
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}
