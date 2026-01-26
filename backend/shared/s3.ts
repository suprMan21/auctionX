import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface S3Config {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export interface UploadUrlParams {
  key: string;
  contentType: string;
  expiresIn?: number;
}

export interface UploadUrlResult {
  uploadUrl: string;
  s3Key: string;
  publicUrl: string;
}

export class S3Service {
  private client: S3Client;
  private bucket: string;
  private region: string;

  constructor(config: S3Config) {
    this.bucket = config.bucket;
    this.region = config.region;
    this.client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async generateUploadUrl(params: UploadUrlParams): Promise<UploadUrlResult> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: params.key,
      ContentType: params.contentType,
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: params.expiresIn || 300,
    });

    return {
      uploadUrl,
      s3Key: params.key,
      publicUrl: this.getPublicUrl(params.key),
    };
  }

  getPublicUrl(key: string): string {
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.client.send(command);
  }

  generateProfilePhotoKey(userId: string, filename: string): string {
    const timestamp = Date.now();
    const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
    return `profiles/${userId}/${timestamp}_${sanitized}`;
  }

  generateListingMediaKey(listingId: string, filename: string): string {
    const timestamp = Date.now();
    const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
    return `listings/${listingId}/${timestamp}_${sanitized}`;
  }

  generateVerificationKey(
    userId: string, 
    type: "id-front" | "id-back" | "video"
  ): string {
    const timestamp = Date.now();
    const ext = type === "video" ? "mp4" : "jpg";
    return `verification/${userId}/${timestamp}_${type}.${ext}`;
  }
}
