/**
 * Request validation for the S-NFC3 tag-management endpoints.
 *
 * Every endpoint validates with Zod before touching the database (project code
 * style: Zod schemas for all validation). `.strict()` throughout so an
 * unexpected field is a 400 rather than a silently ignored one — these are
 * ownership-mutating routes.
 */

import { z } from 'zod';
import { TAP_SESSION_TOKEN_PATTERN } from './tapSession';
import { CHIP_SERIAL_PATTERN } from './ntag424Codec';

const SIG_SHA256_PATTERN = /^[0-9a-f]{64}$/;
/** A chip's name: the path segment of its SUN URL. Mirrors the nfc_tags.chip_name CHECK. */
const CHIP_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const chipName = z.string().regex(CHIP_NAME_PATTERN, 'chipName must be 1 to 64 letters, digits, _ or -');

const uuid = z.string().uuid();

/** A SUN scan presented by the holder: the tapped URL plus the chip UID. */
const sunScan = z.object({
  tagUid: z.string().min(1).max(32),
  sunMessage: z.string().min(1).max(2048),
});

/**
 * S-NFC3-FE: a tap session minted by POST /nfc/tap. Accepted by claim and
 * transfer completion in place of a raw SUN scan — same proof of possession,
 * without making the visitor tap twice.
 */
const tapSessionBody = z.object({
  tapSession: z.string().regex(TAP_SESSION_TOKEN_PATTERN, 'Invalid tap session'),
}).strict();

/** Either a raw SUN scan or a tap session; never both (each arm is strict). */
const possessionProof = z.union([sunScan.extend({}).strict(), tapSessionBody]);

/** POST /nfc/tap: the full tapped URL. */
export const tapSchema = z.object({
  sunMessage: z.string().min(1).max(2048),
}).strict();

/**
 * Staff enrollment. S-NFC3.5: NO key field — chip keys are derived from the
 * KMS root, never sent over the API. `.strict()` turns a legacy `aesKey` into
 * a 400 rather than silently accepting key material.
 */
const enrollFields = z.object({
  tagUid: z.string().regex(/^[0-9a-fA-F]{14}$/, 'tagUid must be a 7-byte UID in hex'),
  tenantId: z.string().min(1).max(64).optional(),
  itemId: uuid.optional(),
  /** S-NFC-ID: the serial the encoder wrote into the chip's URL (v2+ chips). */
  chipSerial: z.string().regex(CHIP_SERIAL_PATTERN, 'chipSerial must be 16 uppercase hex').optional(),
  /** SHA-256 of the chip's NXP Read_Sig bytes: its physical fingerprint. */
  sigSha256: z.string().regex(SIG_SHA256_PATTERN, 'sigSha256 must be 64 lowercase hex').optional(),
  /** The KDF version the encoder personalised with. Defaults to the backend's current version. */
  sdmKeyVersion: z.number().int().min(1).max(255).optional(),
  /** The name reserved for this chip (POST /nfc/enroll/reserve-name). Needs sigSha256. */
  chipName: chipName.optional(),
}).strict();

/** The 7-byte UID path parameter (precheck). */
export const enrollTagUidSchema = enrollFields.shape.tagUid;

export const enrollSchema = enrollFields.refine(
  (v) => v.chipSerial === undefined || (v.sdmKeyVersion !== undefined && v.sdmKeyVersion >= 2 && v.sigSha256 !== undefined),
  { message: 'A chipSerial needs sdmKeyVersion >= 2 and sigSha256' },
).refine(
  (v) => v.chipSerial !== undefined || v.sdmKeyVersion === undefined || v.sdmKeyVersion < 2,
  { message: 'sdmKeyVersion >= 2 needs a chipSerial' },
).refine(
  (v) => v.chipName === undefined || v.sigSha256 !== undefined,
  { message: 'A chipName needs sigSha256 (names are reserved per physical chip)' },
);

/**
 * Encoder name reservation. No `name` = the next chip_NNN in sequence. Runs
 * before the encoder writes anything to the chip.
 */
export const reserveChipNameSchema = z.object({
  sigSha256: z.string().regex(SIG_SHA256_PATTERN, 'sigSha256 must be 64 lowercase hex'),
  name: chipName.optional(),
}).strict();

/** Encoder precheck query (S-NFC-ID). Both absent = the v1 UID-only check. */
export const enrollPrecheckQuerySchema = z.object({
  serial: z.string().regex(CHIP_SERIAL_PATTERN, 'serial must be 16 uppercase hex').optional(),
  sigSha256: z.string().regex(SIG_SHA256_PATTERN, 'sigSha256 must be 64 lowercase hex').optional(),
}).strict();

/**
 * Origin claim. Requires a fresh SUN scan: claiming is the moment ownership
 * binds, so possession of the physical chip must be proven, not asserted.
 */
export const claimSchema = possessionProof;

export const transferInitiateSchema = z.object({
  tagId: uuid,
  transferType: z.enum(['sale', 'gift']),
  /** Exactly one target. An email target may have no account yet (Rule 3). */
  toUserId: uuid.optional(),
  toEmail: z.string().email().max(320).optional(),
  /** Recipient pays by default; the sender may absorb it (Rule 4). */
  feePayer: z.enum(['BUYER', 'SELLER']).default('BUYER'),
}).strict().refine(
  (v) => (v.toUserId === undefined) !== (v.toEmail === undefined),
  { message: 'Provide exactly one of toUserId or toEmail' },
);

export const transferCompleteSchema = possessionProof;

export const releaseSchema = z.object({
  tagId: uuid,
  /**
   * Second confirmation (Rule 6). Release is terminal and irreversible, so the
   * API refuses to act on a single unconfirmed call even if a UI forgets to
   * double-confirm.
   */
  confirm: z.literal(true),
  confirmPhrase: z.literal('RELEASE'),
}).strict();

/**
 * S-ADMIN1 Ph2: a re-issue replaces a chip that is coming loose, before it
 * falls off. The owner proves the chip is still there with a live tap (tap
 * session, spent here) and 1–3 photos already uploaded to the evidence bucket.
 */
export const reissueRequestSchema = z.object({
  tagId: uuid,
  tapSession: z.string().regex(TAP_SESSION_TOKEN_PATTERN, 'Invalid tap session'),
  photoKeys: z.array(z.string().min(1).max(200)).min(1).max(3)
    .refine((keys) => new Set(keys).size === keys.length, { message: 'Duplicate photo' }),
}).strict();

/** Asks for one presigned upload URL for an evidence photo (JPEG only). */
export const reissuePhotoUrlSchema = z.object({
  contentType: z.literal('image/jpeg'),
  sizeBytes: z.number().int().min(1).max(5 * 1024 * 1024),
}).strict();

export const reissueRequestIdSchema = uuid;

export const disclosureSchema = z.object({
  origin_video: z.boolean().optional(),
  creator_name: z.boolean().optional(),
  claim_date: z.boolean().optional(),
  location: z.boolean().optional(),
}).strict().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'At least one disclosure field is required' },
);

export type DisclosureInput = z.infer<typeof disclosureSchema>;
export const DISCLOSURE_FIELDS = [
  'origin_video',
  'creator_name',
  'claim_date',
  'location',
] as const;
