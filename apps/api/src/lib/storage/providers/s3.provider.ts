import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type {
  StorageProvider,
  StorageUploadResult,
} from "../provider.interface";

export interface S3StorageConfig {
  endpoint?: string;
  region?: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  publicUrl?: string;
}

export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;
  private endpoint?: string;
  private publicUrl?: string;
  private forcePathStyle: boolean;

  constructor(cfg: S3StorageConfig) {
    this.bucket = cfg.bucket;
    this.endpoint = cfg.endpoint;
    this.publicUrl = cfg.publicUrl;
    this.forcePathStyle = cfg.forcePathStyle ?? false;

    this.client = new S3Client({
      ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
      ...(cfg.region ? { region: cfg.region } : { region: "us-east-1" }),
      forcePathStyle: this.forcePathStyle,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
  }

  async upload(
    buffer: Buffer,
    key: string,
    contentType: string,
  ): Promise<StorageUploadResult> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    const url = this.buildUrl(key);
    return { url, key, path: `/${key}`, provider: "s3" };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  private buildUrl(key: string): string {
    if (this.publicUrl) {
      const base = this.publicUrl.replace(/\/+$/, "");
      return `${base}/${encodeURIComponent(key)}`;
    }

    if (this.endpoint) {
      const base = this.endpoint.replace(/\/+$/, "");
      if (this.forcePathStyle) {
        return `${base}/${this.bucket}/${encodeURIComponent(key)}`;
      }
      // Virtual-hosted style
      const url = new URL(base);
      return `${url.protocol}//${this.bucket}.${url.host}/${encodeURIComponent(key)}`;
    }

    // Default AWS S3 URL
    return `https://${this.bucket}.s3.amazonaws.com/${encodeURIComponent(key)}`;
  }
}
