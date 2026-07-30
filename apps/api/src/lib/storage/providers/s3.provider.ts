import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  StorageProvider,
  StorageUploadResult,
} from "../provider.interface";

// SigV4 hard limit for presigned URLs.
const MAX_SIGNED_URL_TTL_SECONDS = 604800;

export interface S3StorageConfig {
  endpoint?: string;
  region?: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  publicUrl?: string;
  // Return a presigned GET URL rather than a bare object URL. Lets the bucket
  // stay private; the trade-off is that the link expires.
  signedUrls?: boolean;
  signedUrlTtlSeconds?: number;
  // Host to sign against, when the caller reaches the bucket somewhere other
  // than `endpoint` (MinIO published on a different port, say). The signature
  // covers the host, so this cannot be patched in after signing.
  signingEndpoint?: string;
}

export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private signingClient: S3Client;
  private bucket: string;
  private endpoint?: string;
  private publicUrl?: string;
  private forcePathStyle: boolean;
  private signedUrls: boolean;
  private signedUrlTtlSeconds: number;

  constructor(cfg: S3StorageConfig) {
    this.bucket = cfg.bucket;
    this.endpoint = cfg.endpoint;
    this.publicUrl = cfg.publicUrl;
    this.forcePathStyle = cfg.forcePathStyle ?? false;
    this.signedUrls = cfg.signedUrls ?? false;
    this.signedUrlTtlSeconds = Math.min(
      cfg.signedUrlTtlSeconds ?? 3600,
      MAX_SIGNED_URL_TTL_SECONDS,
    );

    const clientOptions = (endpoint?: string) => ({
      ...(endpoint ? { endpoint } : {}),
      ...(cfg.region ? { region: cfg.region } : { region: "us-east-1" }),
      forcePathStyle: this.forcePathStyle,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });

    this.client = new S3Client(clientOptions(cfg.endpoint));
    this.signingClient =
      cfg.signingEndpoint && cfg.signingEndpoint !== cfg.endpoint
        ? new S3Client(clientOptions(cfg.signingEndpoint))
        : this.client;
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

    const url = this.signedUrls
      ? await getSignedUrl(
          // client-s3 and s3-request-presigner ship from the same SDK release
          // but resolve to different @smithy/core copies under pnpm, so their
          // `Client` classes are structurally distinct to tsc ("separate
          // declarations of a private property 'handlers'"). The runtime
          // contract is identical; deduping @smithy across the tree would mean
          // lockfile-wide overrides for a cosmetic type clash.
          this.signingClient as unknown as Parameters<typeof getSignedUrl>[0],
          new GetObjectCommand({ Bucket: this.bucket, Key: key }),
          { expiresIn: this.signedUrlTtlSeconds },
        )
      : this.buildUrl(key);

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

  async fetch(key: string) {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!result.Body) return null;
      return {
        body: Buffer.from(await result.Body.transformToByteArray()),
        contentType: result.ContentType,
      };
    } catch (error: any) {
      // Missing object must read as "not found", not as a server error.
      const status = error?.$metadata?.httpStatusCode;
      if (
        status === 404 ||
        error?.name === "NoSuchKey" ||
        error?.name === "NotFound"
      ) {
        return null;
      }
      throw error;
    }
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
