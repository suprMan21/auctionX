/**
 * KMS-backed Ethereum signer — S-ANCHOR1 Ph1.
 *
 * The registry writer key is an AWS KMS ECC_SECG_P256K1 key. It is created
 * non-exportable and only the App Runner instance role may call kms:Sign on it
 * (scripts/anchor/create-writer-key.sh). This module turns it into a viem
 * account: the backend sends KMS a 32-byte digest and gets back a DER
 * signature; the private key is never seen by this process.
 *
 * KMS returns plain ECDSA. Ethereum also needs:
 *   - low-s (EIP-2): s above n/2 is replaced by n - s, or nodes reject the tx;
 *   - a recovery bit (yParity): found by recovering both candidates and keeping
 *     the one that yields our address.
 */

import { GetPublicKeyCommand, KMSClient, SignCommand } from '@aws-sdk/client-kms';
import {
  hashMessage,
  keccak256,
  recoverAddress,
  serializeSignature,
  serializeTransaction,
  toHex,
  type Hex,
  type LocalAccount,
  type Signature,
} from 'viem';
import { publicKeyToAddress, toAccount } from 'viem/accounts';
import { emitSecurityEvent } from '../security/securityEvent';
import type { SecurityLogContext } from '../ownership/ownershipProof';

/** secp256k1 group order. */
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HALF_N = N / 2n;

/** The minimal KMS surface this module needs, so tests can stand in a local key. */
export interface KmsSignClient {
  send(command: GetPublicKeyCommand | SignCommand): Promise<{ PublicKey?: Uint8Array; Signature?: Uint8Array }>;
}

// ── DER parsing ─────────────────────────────────────────────────────────────

const readLength = (der: Uint8Array, at: number): { length: number; next: number } => {
  const first = der[at];
  if (first === undefined) throw new Error('der_truncated');
  if (first < 0x80) return { length: first, next: at + 1 };
  const bytes = first & 0x7f;
  if (bytes < 1 || bytes > 2) throw new Error('der_length_unsupported');
  let length = 0;
  for (let i = 0; i < bytes; i++) {
    const b = der[at + 1 + i];
    if (b === undefined) throw new Error('der_truncated');
    length = (length << 8) | b;
  }
  return { length, next: at + 1 + bytes };
};

/**
 * SubjectPublicKeyInfo for secp256k1 ends in a BIT STRING holding the
 * uncompressed point 0x04 || X || Y. Returns that 65-byte point.
 */
export const spkiToUncompressedPoint = (spki: Uint8Array): Uint8Array => {
  const point = spki.slice(spki.length - 65);
  if (point.length !== 65 || point[0] !== 0x04) throw new Error('kms_public_key_unexpected');
  // The byte before the point is the BIT STRING's "unused bits" (0), and before
  // that its length (66). Checking both rejects a key of any other shape.
  if (spki[spki.length - 66] !== 0x00 || spki[spki.length - 67] !== 0x42) {
    throw new Error('kms_public_key_unexpected');
  }
  return point;
};

/** ECDSA-Sig-Value ::= SEQUENCE { r INTEGER, s INTEGER } → (r, s). */
export const parseDerSignature = (der: Uint8Array): { r: bigint; s: bigint } => {
  if (der[0] !== 0x30) throw new Error('der_not_sequence');
  const seq = readLength(der, 1);
  if (seq.next + seq.length !== der.length) throw new Error('der_length_mismatch');

  const readInt = (at: number): { value: bigint; next: number } => {
    if (der[at] !== 0x02) throw new Error('der_not_integer');
    const len = readLength(der, at + 1);
    if (len.length < 1 || len.length > 33) throw new Error('der_integer_size');
    const bytes = der.slice(len.next, len.next + len.length);
    return { value: BigInt(toHex(bytes)), next: len.next + len.length };
  };

  const r = readInt(seq.next);
  const s = readInt(r.next);
  if (s.next !== der.length) throw new Error('der_trailing_bytes');
  if (r.value <= 0n || r.value >= N || s.value <= 0n || s.value >= N) throw new Error('der_out_of_range');
  return { r: r.value, s: s.value };
};

/** EIP-2: Ethereum only accepts the low-s form. */
export const normaliseS = (s: bigint): bigint => (s > HALF_N ? N - s : s);

const toBytes32Hex = (n: bigint): Hex => `0x${n.toString(16).padStart(64, '0')}`;

// ── Signer ──────────────────────────────────────────────────────────────────

export interface KmsSigner {
  readonly address: `0x${string}`;
  readonly account: LocalAccount;
  signDigest(hash: Hex): Promise<Signature>;
}

const emitKms = (operation: 'Sign' | 'GetPublicKey', result: 'ok' | 'internal', ctx: SecurityLogContext) =>
  emitSecurityEvent({
    event: 'kms.op',
    operation,
    purpose: 'anchor_writer',
    tag_id: null,
    result,
    request_id: ctx.requestId,
    actor_id: ctx.actorId,
    actor_type: ctx.actorType,
    ip: ctx.ip,
    route: ctx.route,
  });

export const createKmsSigner = async (
  keyId: string,
  ctx: SecurityLogContext,
  client: KmsSignClient = new KMSClient({ region: process.env.AWS_REGION || 'us-east-2' }),
): Promise<KmsSigner> => {
  let spki: Uint8Array | undefined;
  try {
    spki = (await client.send(new GetPublicKeyCommand({ KeyId: keyId }))).PublicKey;
    if (!spki) throw new Error('kms_public_key_missing');
  } catch (err) {
    emitKms('GetPublicKey', 'internal', ctx);
    throw err;
  }
  emitKms('GetPublicKey', 'ok', ctx);

  const address = publicKeyToAddress(toHex(spkiToUncompressedPoint(spki)));

  const signDigest = async (hash: Hex): Promise<Signature> => {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('digest_must_be_32_bytes');

    let der: Uint8Array | undefined;
    try {
      der = (await client.send(new SignCommand({
        KeyId: keyId,
        Message: Buffer.from(hash.slice(2), 'hex'),
        MessageType: 'DIGEST',
        SigningAlgorithm: 'ECDSA_SHA_256',
      }))).Signature;
      if (!der) throw new Error('kms_signature_missing');
    } catch (err) {
      emitKms('Sign', 'internal', ctx);
      throw err;
    }
    emitKms('Sign', 'ok', ctx);

    const { r, s: rawS } = parseDerSignature(der);
    const s = normaliseS(rawS);

    for (const yParity of [0, 1] as const) {
      const candidate: Signature = { r: toBytes32Hex(r), s: toBytes32Hex(s), yParity };
      const recovered = await recoverAddress({ hash, signature: serializeSignature(candidate) });
      if (recovered.toLowerCase() === address.toLowerCase()) return candidate;
    }
    throw new Error('kms_signature_unrecoverable');
  };

  const account = toAccount({
    address,
    async signMessage({ message }) {
      return serializeSignature(await signDigest(hashMessage(message)));
    },
    async signTransaction(transaction, options) {
      const serializer = options?.serializer ?? serializeTransaction;
      const signature = await signDigest(keccak256(await serializer(transaction)));
      return serializer(transaction, signature);
    },
    async signTypedData() {
      throw new Error('typed_data_not_supported');
    },
  });

  return { address, account, signDigest };
};
