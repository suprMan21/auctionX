import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

if (!process.env.AWS_ACCESS_KEY_ID) {
  throw new Error("AWS_ACCESS_KEY_ID not set in environment");
}
if (!process.env.AWS_SECRET_ACCESS_KEY) {
  throw new Error("AWS_SECRET_ACCESS_KEY not set in environment");
}
if (!process.env.AWS_S3_BUCKET) {
  throw new Error("AWS_S3_BUCKET not set in environment");
}

const BUCKET_NAME = process.env.AWS_S3_BUCKET;
const AWS_REGION = process.env.AWS_REGION || "us-east-2";

const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
export const MAX_VIDEO_SIZE = 50 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const ALLOWED_VIDEO_TYPES = ['video/mp4'];

export async function generateUploadUrl(params: {
  key: string;
  contentType: string;
  expiresIn?: number;
}): Promise<string> {
  const isImage = ALLOWED_IMAGE_TYPES.includes(params.contentType);
  const isVideo = ALLOWED_VIDEO_TYPES.includes(params.contentType);
  
  if (!isImage && !isVideo) {
    throw new Error(`Invalid content type: ${params.contentType}`);
  }

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: params.key,
    ContentType: params.contentType,
  });

  return getSignedUrl(s3Client, command, {
    expiresIn: params.expiresIn || 300,
  });
}

export function getPublicUrl(key: string): string {
  const cloudfrontDomain = process.env.AWS_CLOUDFRONT_DOMAIN;
  if (cloudfrontDomain) {
    return `https://${cloudfrontDomain}/${key}`;
  }
  
  return `https://${BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${key}`;
}

export async function deleteObject(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });
  await s3Client.send(command);
}

export async function deleteObjects(keys: string[]): Promise<void> {
  await Promise.all(keys.map(key => deleteObject(key)));
}

export function generateListingMediaKey(listingId: string, filename: string): string {
  const timestamp = Date.now();
  const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
  return `listings/${listingId}/${timestamp}_${sanitized}`;
}

export function generateProfilePhotoKey(userId: string, filename: string): string {
  const timestamp = Date.now();
  const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
  return `profiles/${userId}/${timestamp}_${sanitized}`;
}

export function generateVerificationKey(
  userId: string, 
  type: "id-front" | "id-back" | "video"
): string {
  const timestamp = Date.now();
  const ext = type === "video" ? "mp4" : "jpg";
  return `verification/${userId}/${timestamp}_${type}.${ext}`;
}

export function validateFileSize(sizeBytes: number, contentType: string): void {
  const isImage = ALLOWED_IMAGE_TYPES.includes(contentType);
  const isVideo = ALLOWED_VIDEO_TYPES.includes(contentType);
  
  if (isImage && sizeBytes > MAX_IMAGE_SIZE) {
    throw new Error(`Image size exceeds ${MAX_IMAGE_SIZE / 1024 / 1024}MB limit`);
  }
  
  if (isVideo && sizeBytes > MAX_VIDEO_SIZE) {
    throw new Error(`Video size exceeds ${MAX_VIDEO_SIZE / 1024 / 1024}MB limit`);
  }
}

export function getFileExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

export function getContentTypeFromExtension(ext: string): string | null {
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    mp4: "video/mp4",
  };
  return map[ext.toLowerCase()] || null;
}
