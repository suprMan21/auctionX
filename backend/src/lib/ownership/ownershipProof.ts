/**
 * Ownership ID + Receipt — S-NFC3.
 *
 * Every origin claim and every completed transfer mints a fresh ownership
 * proof. This module generates and stores only; anchoring on-chain is
 * S-ANCHOR1, and nothing here makes a chain, Alchemy or Pinata call.
 *
 *   ownership_id = keccak256( tag_ref || ownership_event_id || salt )
 *
 * The preimage contains NO account id and NO personal data, by design: an
 * Ownership ID is publishable, and publishing one must reveal nothing about who
 * holds the token.
 *
 * THE OWNERSHIP ID NEVER AUTHORIZES ANYTHING. No endpoint accepts it as proof
 * of authority — it is an identifier and a receipt, never a credential. Holding
 * one proves only that its holder saw it.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { keccak256 } from 'viem';
import { emitSecurityEvent, type SecurityResult } from '../security/securityEvent';

/** 32 random bytes, per the brief. */
export const OWNERSHIP_SALT_BYTES = 32;

export type OwnershipEventType = 'claim' | 'transfer';

/**
 * Canonical preimage encoding. An independent implementation must produce the
 * same bytes, so this is specified exactly rather than left to whatever
 * `Buffer.concat` happened to receive:
 *
 *   [ utf8(tag_ref) ][ 16 raw bytes of ownership_event_id ][ 32 bytes salt ]
 *
 * `ownership_event_id` is a UUID and contributes its 16 RAW bytes, not its
 * 36-character hyphenated text — hex text would double the length and silently
 * change the digest.
 */
export const buildPreimage = (
  tagRef: string,
  ownershipEventId: string,
  salt: Buffer,
): Buffer => {
  const hex = ownershipEventId.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error('ownershipEventId must be a UUID');
  }
  if (salt.length !== OWNERSHIP_SALT_BYTES) {
    throw new Error(`salt must be ${OWNERSHIP_SALT_BYTES} bytes`);
  }

  return Buffer.concat([
    Buffer.from(tagRef, 'utf8'),
    Buffer.from(hex, 'hex'),
    salt,
  ]);
};

/** Lowercase 0x-prefixed bytes32, matching `ownership_proofs_id_format_chk`. */
export const computeOwnershipId = (
  tagRef: string,
  ownershipEventId: string,
  salt: Buffer,
): string => keccak256(buildPreimage(tagRef, ownershipEventId, salt));

// ── Salt envelope ───────────────────────────────────────────────────────────

/**
 * The salt is stored encrypted so the owner can re-download their Receipt, and
 * so that a database read alone cannot recompute an Ownership ID from a
 * published tag_ref.
 *
 * Provider shape mirrors `tag-encoder/providers/kms_key_provider.py`: one
 * interface, a local implementation today, an AWS KMS implementation when the
 * CMK is provisioned. The emitted `kms.op` events use the KMS operation names
 * in both cases, so the S-SEC0 detections written against them keep working
 * unchanged after the swap.
 *
 * LOCAL PROVIDER: AES-256-GCM under `OWNERSHIP_SALT_KEY` (base64, 32 bytes).
 * Stored as `v1.<iv>.<authTag>.<ciphertext>`, all base64. The version prefix is
 * what lets a future KMS provider decrypt old rows instead of orphaning them.
 */
export interface SaltEnvelopeProvider {
  readonly name: string;
  encrypt(salt: Buffer): string;
  decrypt(envelope: string): Buffer;
}

const LOCAL_ENVELOPE_VERSION = 'v1';

const readLocalKey = (): Buffer => {
  const raw = process.env.OWNERSHIP_SALT_KEY;
  if (!raw) {
    throw new Error(
      'OWNERSHIP_SALT_KEY is not set — cannot envelope ownership salts',
    );
  }

  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('OWNERSHIP_SALT_KEY must be 32 bytes, base64-encoded');
  }
  return key;
};

export const localSaltEnvelopeProvider: SaltEnvelopeProvider = {
  name: 'local-aes-256-gcm',

  encrypt(salt: Buffer): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', readLocalKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(salt), cipher.final()]);

    return [
      LOCAL_ENVELOPE_VERSION,
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      ciphertext.toString('base64'),
    ].join('.');
  },

  decrypt(envelope: string): Buffer {
    const [version, ivB64, tagB64, ctB64] = envelope.split('.');
    if (version !== LOCAL_ENVELOPE_VERSION || !ivB64 || !tagB64 || !ctB64) {
      throw new Error('Unrecognised salt envelope format');
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      readLocalKey(),
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final(),
    ]);
  },
};

let activeProvider: SaltEnvelopeProvider = localSaltEnvelopeProvider;

/** Swap point for the AWS KMS provider (and for tests). */
export const setSaltEnvelopeProvider = (provider: SaltEnvelopeProvider): void => {
  activeProvider = provider;
};

export const getSaltEnvelopeProvider = (): SaltEnvelopeProvider => activeProvider;

// ── Minting ─────────────────────────────────────────────────────────────────

export interface SecurityLogContext {
  readonly requestId: string;
  readonly actorId: string | null;
  readonly actorType: 'user' | 'staff' | 'admin' | 'anon' | 'system';
  readonly ip: string;
  readonly route: string;
}

export interface MintedOwnershipProof {
  readonly ownershipId: string;
  readonly tagRef: string;
  readonly saltEnc: string;
  readonly ownershipEventId: string;
  readonly ownershipEventType: OwnershipEventType;
}

/**
 * Derives the public, non-UID tag reference used in the preimage.
 *
 * Deliberately the internal `nfc_tags.id`, never the chip UID: the UID is
 * readable by anyone who taps the tag, so including it would let a stranger who
 * also learned a salt recompute an Ownership ID.
 */
export const tagRefFor = (tagId: string): string => `am:tag:${tagId}`;

/**
 * Mints a fresh proof. Returns the row fields for `ownership_proofs`; the
 * caller is responsible for flipping the previous `current` proof to `stale` in
 * the same write.
 *
 * The plaintext salt is never returned, never stored and never logged — it
 * leaves this function only inside `saltEnc`.
 */
export const mintOwnershipProof = (
  params: {
    readonly tagId: string;
    readonly ownershipEventId: string;
    readonly ownershipEventType: OwnershipEventType;
  },
  ctx: SecurityLogContext,
): MintedOwnershipProof => {
  const salt = randomBytes(OWNERSHIP_SALT_BYTES);
  const tagRef = tagRefFor(params.tagId);
  const ownershipId = computeOwnershipId(tagRef, params.ownershipEventId, salt);

  let saltEnc: string;
  let result: SecurityResult = 'ok';
  try {
    saltEnc = activeProvider.encrypt(salt);
  } catch (err) {
    result = 'internal';
    emitKmsOp('Encrypt', params.tagId, result, ctx);
    throw err;
  } finally {
    salt.fill(0);
  }

  emitKmsOp('Encrypt', params.tagId, result, ctx);

  return {
    ownershipId,
    tagRef,
    saltEnc,
    ownershipEventId: params.ownershipEventId,
    ownershipEventType: params.ownershipEventType,
  };
};

/**
 * Recovers the Receipt preimage fields for the owner to download.
 *
 * PRIVATE — the salt is the secret half of the proof. Revealing the Receipt is
 * what proves the holder held that ownership, so this must only ever be called
 * behind an owner check.
 */
export const openReceipt = (
  params: { readonly tagId: string; readonly saltEnc: string },
  ctx: SecurityLogContext,
): { readonly tagRef: string; readonly saltHex: string } => {
  let salt: Buffer;
  try {
    salt = activeProvider.decrypt(params.saltEnc);
  } catch (err) {
    emitKmsOp('Decrypt', params.tagId, 'internal', ctx);
    throw err;
  }

  emitKmsOp('Decrypt', params.tagId, 'ok', ctx);

  return { tagRef: tagRefFor(params.tagId), saltHex: salt.toString('hex') };
};

const emitKmsOp = (
  operation: 'Encrypt' | 'Decrypt' | 'GenerateDataKey',
  tagId: string | null,
  result: SecurityResult,
  ctx: SecurityLogContext,
): void => {
  emitSecurityEvent({
    event: 'kms.op',
    operation,
    purpose: 'ownership_salt',
    tag_id: tagId,
    result,
    request_id: ctx.requestId,
    actor_id: ctx.actorId,
    actor_type: ctx.actorType,
    ip: ctx.ip,
    route: ctx.route,
  });
};
