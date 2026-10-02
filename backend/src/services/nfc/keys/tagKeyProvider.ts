/**
 * Chip-key providers — S-NFC3.5.
 *
 * ONE interface, two implementations, identical output for identical root
 * bytes (pinned by the shared OpenSSL vectors):
 *
 *   kms    HMAC step runs inside AWS KMS (`GenerateMac`, HMAC_SHA_256) against
 *          the SDM-root HMAC_256 key (`alias/am-tag-sdm-staging` on staging).
 *          The root never leaves KMS.
 *   local  HMAC step runs in-process against NFC_LOCAL_SDM_ROOT_KEY. Refuses
 *          to construct unless NFC_ALLOW_LOCAL_KEYS=true (staging until Boss
 *          provisions KMS).
 *
 * The backend holds the SDM root ONLY (roles META + FILE). The admin root
 * (application master keys) is encoder-only; nothing here can address it, and
 * `assertValidRequest` rejects any other role at runtime.
 *
 * HARD RULES (tested in sdmKeyHygiene.test.ts / kmsNoCreate.test.ts):
 *   - Derived keys live only in memory for the duration of one encode/verify.
 *     No caching, never persisted, never logged, never returned in a response.
 *   - No code path creates, aliases or imports a KMS key. One-time setup is a
 *     documented Boss action, not code.
 *   - Every derivation emits `kms.op` (operation GenerateMac, purpose tag_key)
 *     with no UID and no key material — from BOTH providers, so S-SEC0
 *     detections do not change when staging flips from local to KMS.
 */

import { createHmac } from 'crypto';
import { GenerateMacCommand, KMSClient } from '@aws-sdk/client-kms';
import { emitSecurityEvent, type SecurityResult } from '../../../lib/security/securityEvent';
import type { SecurityLogContext } from '../../../lib/ownership/ownershipProof';
import {
  PRK_LEN,
  assertValidRequest,
  expandToAesKey,
  kdfMessage,
  type TagKeyRequest,
} from './keyDerivation';

export interface KeyAuditContext {
  readonly ctx: SecurityLogContext;
  readonly tagId?: string | null;
}

export interface TagKeyProvider {
  readonly name: 'kms' | 'local';
  /** Derives one 16-byte AES-128 key. The caller must not retain it. */
  deriveKey(req: TagKeyRequest, audit: KeyAuditContext): Promise<Buffer>;
}

/** Minimal slice of KMSClient we use — lets tests inject a mock, no network. */
export interface KmsMacClient {
  send(command: GenerateMacCommand): Promise<{ Mac?: Uint8Array }>;
}

const emitGenerateMac = (audit: KeyAuditContext, result: SecurityResult): void => {
  emitSecurityEvent({
    event: 'kms.op',
    operation: 'GenerateMac',
    purpose: 'tag_key',
    tag_id: audit.tagId ?? null,
    result,
    request_id: audit.ctx.requestId,
    actor_id: audit.ctx.actorId,
    actor_type: audit.ctx.actorType,
    ip: audit.ctx.ip,
    route: audit.ctx.route,
  });
};

/** Best-effort zeroisation of an intermediate secret buffer. */
const wipe = (buf: Buffer | Uint8Array | undefined): void => {
  if (buf) buf.fill(0);
};

// ── KMS ─────────────────────────────────────────────────────────────────────

export interface KmsProviderOptions {
  readonly keyId: string;
  readonly region: string;
  /** Injected in tests. Production builds a real KMSClient. */
  readonly client?: KmsMacClient;
}

export const createKmsTagKeyProvider = (opts: KmsProviderOptions): TagKeyProvider => {
  const client: KmsMacClient = opts.client ?? new KMSClient({ region: opts.region });

  return {
    name: 'kms',
    deriveKey: async (req, audit) => {
      assertValidRequest(req);
      let mac: Uint8Array | undefined;
      try {
        const out = await client.send(
          new GenerateMacCommand({
            KeyId: opts.keyId,
            MacAlgorithm: 'HMAC_SHA_256',
            Message: kdfMessage(req),
          }),
        );
        mac = out.Mac;
        if (!mac || mac.length !== PRK_LEN) {
          throw new Error('KMS GenerateMac returned an unexpected MAC length');
        }
        const prk = Buffer.from(mac);
        const key = expandToAesKey(prk, req);
        wipe(prk);
        emitGenerateMac(audit, 'ok');
        return key;
      } catch (err) {
        emitGenerateMac(audit, 'internal');
        // Never propagate KMS error text: it can echo request parameters.
        throw new Error('Tag key derivation failed', { cause: err instanceof Error ? err.name : 'unknown' });
      } finally {
        wipe(mac);
      }
    },
  };
};

// ── Local (staging / dev only) ──────────────────────────────────────────────

export interface LocalProviderOptions {
  /** 32-byte SDM root, as 64 hex chars. */
  readonly sdmRootKeyHex: string | undefined;
  /** Must be true or construction throws. */
  readonly allowLocalKeys: boolean;
}

export const createLocalTagKeyProvider = (opts: LocalProviderOptions): TagKeyProvider => {
  if (!opts.allowLocalKeys) {
    throw new Error('Local NFC key provider refused: set NFC_ALLOW_LOCAL_KEYS=true to permit it');
  }
  if (!opts.sdmRootKeyHex || !/^[0-9a-fA-F]{64}$/.test(opts.sdmRootKeyHex)) {
    throw new Error('NFC_LOCAL_SDM_ROOT_KEY must be 64 hex chars (32 bytes)');
  }
  const root = Buffer.from(opts.sdmRootKeyHex, 'hex');

  return {
    name: 'local',
    deriveKey: async (req, audit) => {
      try {
        assertValidRequest(req);
        const prk = createHmac('sha256', root).update(kdfMessage(req)).digest();
        const key = expandToAesKey(prk, req);
        wipe(prk);
        emitGenerateMac(audit, 'ok');
        return key;
      } catch (err) {
        emitGenerateMac(audit, 'internal');
        throw err;
      }
    },
  };
};
