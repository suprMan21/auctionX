/**
 * Re-issue evidence photos — S-ADMIN1 Ph2.
 *
 * An owner asking for a replacement chip proves the old one is still attached:
 * a live tap plus 1–3 photos from the web app's camera. Those photos are
 * private evidence, so they live in their OWN bucket (`REISSUE_EVIDENCE_BUCKET`,
 * all public access blocked), never in the media bucket, which serves every
 * object publicly by path (bucket policy `PublicReadGetObject`, read
 * 2026-10-09).
 *
 * Rules:
 *   1. Keys are `reissue-evidence/<userId>/<uuid>.jpg`, generated here. A request
 *      may only reference keys under the caller's own prefix.
 *   2. Upload is a presigned PUT (5 min). The object is checked with HEAD at
 *      submit time (exists, image/jpeg, size cap) — the client is not trusted to
 *      have uploaded what it was given a URL for.
 *   3. Admins view photos through presigned GETs (5 min). No plain URL is ever
 *      built or returned.
 *   4. No bucket configured → the feature is unavailable, never a fallback to
 *      the public media bucket.
 */

import { randomUUID } from 'crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppError } from './errors';

export const EVIDENCE_CONTENT_TYPE = 'image/jpeg';
export const EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
export const EVIDENCE_MAX_PHOTOS = 3;
const URL_TTL_SECONDS = 300;

const region = (): string => process.env.AWS_REGION || 'us-east-2';

const evidenceBucket = (): string => {
  const bucket = process.env.REISSUE_EVIDENCE_BUCKET;
  if (!bucket) throw new AppError('unavailable', 'Photo upload is not available right now');
  return bucket;
};

const client = (): S3Client =>
  new S3Client({
    region: region(),
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** True only for a key this module would have generated for `userId`. */
export const isOwnEvidenceKey = (key: string, userId: string): boolean =>
  new RegExp(`^reissue-evidence/${userId}/${UUID}\\.jpg$`).test(key);

export const evidenceUploadUrl = async (
  userId: string,
  sizeBytes: number,
): Promise<{ uploadUrl: string; key: string }> => {
  const key = `reissue-evidence/${userId}/${randomUUID()}.jpg`;
  const command = new PutObjectCommand({
    Bucket: evidenceBucket(),
    Key: key,
    ContentType: EVIDENCE_CONTENT_TYPE,
    ContentLength: sizeBytes,
  });
  const uploadUrl = await getSignedUrl(client(), command, {
    expiresIn: URL_TTL_SECONDS,
    signableHeaders: new Set(['content-type', 'content-length']),
  });
  return { uploadUrl, key };
};

/**
 * Confirms an uploaded photo is really there and is what was promised.
 * Returns false for a missing object, a wrong type or an oversized file.
 */
export const evidenceObjectIsValid = async (key: string): Promise<boolean> => {
  try {
    const head = await client().send(new HeadObjectCommand({ Bucket: evidenceBucket(), Key: key }));
    return (
      head.ContentType === EVIDENCE_CONTENT_TYPE &&
      typeof head.ContentLength === 'number' &&
      head.ContentLength > 0 &&
      head.ContentLength <= EVIDENCE_MAX_BYTES
    );
  } catch (err) {
    if (err instanceof AppError) throw err;
    return false;
  }
};

/** Short-lived view URL for the admin queue. */
export const evidenceViewUrl = async (key: string): Promise<string> =>
  getSignedUrl(client(), new GetObjectCommand({ Bucket: evidenceBucket(), Key: key }), {
    expiresIn: URL_TTL_SECONDS,
  });
