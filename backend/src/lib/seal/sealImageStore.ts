/**
 * S-SEAL1 Ph2b: seal pictures in S3 (bucket SEAL_IMAGES_BUCKET, private, read by CloudFront through OAC).
 *
 *   seal-img/<XXXX-XXXX>/preview-v1.png   public through CloudFront /seal-img/*, 1 day cache
 *   seal-img/generic-v1.png               public, the picture for unknown and inactive seals
 *   share/<XXXX-XXXX>/share-v1.png        never public: only the owner endpoint reads it
 *
 * Credentials: the default AWS chain only (App Runner instance role `am-backend-staging-instance`,
 * inline policy SealImagesStaging). The static keys in the environment are not used here.
 * No bucket configured: every call is a no-op / miss, so drawing never blocks anything.
 */
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export const SEAL_IMAGE_VERSION = 'v1';

/**
 * `variant` (share only) names what the picture prints besides the seal: a short hash of the base URL,
 * so a new PUBLIC_SEAL_BASE_URL draws fresh pictures instead of serving old QR codes.
 */
export const sealImageKeys = (displayCode: string, variant = 'x') => ({
  preview: `seal-img/${displayCode}/preview-${SEAL_IMAGE_VERSION}.png`,
  share: `share/${displayCode}/share-${SEAL_IMAGE_VERSION}-${variant.replace(/[^a-z0-9]/g, '')}.png`,
});

export const GENERIC_IMAGE_KEY = `seal-img/generic-${SEAL_IMAGE_VERSION}.png`;

// 10 min: a preview removed when a seal goes on hold, is released or retired leaves CloudFront
// soon after (the tick runs every 10 min). The generic picture never changes.
const PREVIEW_CACHE = 'public, max-age=600';
const GENERIC_CACHE = 'public, max-age=86400';
const PRIVATE_CACHE = 'private, no-store';

export type SealImageStore = {
  readonly configured: boolean;
  putPreview(displayCode: string, png: Buffer): Promise<void>;
  putGeneric(png: Buffer): Promise<void>;
  getShare(displayCode: string, variant: string): Promise<Buffer | null>;
  putShare(displayCode: string, variant: string, png: Buffer): Promise<void>;
  /** Removes the preview and share pictures of a seal (missing objects are fine). */
  remove(displayCode: string, variant: string): Promise<void>;
};

let cachedClient: S3Client | null = null;
const client = (): S3Client =>
  (cachedClient ??= new S3Client({
    region: process.env.AWS_REGION || 'us-east-2',
    // Enroll awaits a store: a hung S3 call must not hang the encoder (SDK default is no timeout).
    requestHandler: { connectionTimeout: 2000, requestTimeout: 5000 },
    maxAttempts: 2,
  }));

const unconfigured: SealImageStore = {
  configured: false,
  putPreview: async () => {},
  putGeneric: async () => {},
  getShare: async () => null,
  putShare: async () => {},
  remove: async () => {},
};

/** The store for SEAL_IMAGES_BUCKET, or a no-op store when it is not set. */
export const sealImageStore = (): SealImageStore => {
  const bucket = process.env.SEAL_IMAGES_BUCKET?.trim();
  if (!bucket) return unconfigured;

  const put = async (key: string, png: Buffer, cacheControl: string) => {
    await client().send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: png, ContentType: 'image/png', CacheControl: cacheControl }),
    );
  };

  return {
    configured: true,
    putPreview: (code, png) => put(sealImageKeys(code).preview, png, PREVIEW_CACHE),
    putGeneric: (png) => put(GENERIC_IMAGE_KEY, png, GENERIC_CACHE),
    putShare: (code, variant, png) => put(sealImageKeys(code, variant).share, png, PRIVATE_CACHE),
    getShare: async (code, variant) => {
      try {
        const out = await client().send(new GetObjectCommand({ Bucket: bucket, Key: sealImageKeys(code, variant).share }));
        const bytes = await out.Body?.transformToByteArray();
        return bytes ? Buffer.from(bytes) : null;
      } catch (err) {
        if (err instanceof NoSuchKey) return null;
        // No ListBucket permission makes a missing key look like AccessDenied: treat both as a miss.
        if (err instanceof Error && (err.name === 'NoSuchKey' || err.name === 'AccessDenied')) return null;
        throw err;
      }
    },
    remove: async (code, variant) => {
      const keys = sealImageKeys(code, variant);
      await client().send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: [{ Key: keys.preview }, { Key: keys.share }], Quiet: true },
        }),
      );
    },
  };
};
