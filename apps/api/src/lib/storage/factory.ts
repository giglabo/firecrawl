import type { StorageProvider } from "./provider.interface";
import {
  S3StorageProvider,
  type S3StorageConfig,
} from "./providers/s3.provider";
import {
  LocalStorageProvider,
  type LocalStorageConfig,
} from "./providers/local.provider";
import { config } from "../../config";

interface RequestStorageConfig {
  provider: "s3" | "local";
  s3?: S3StorageConfig;
  local?: LocalStorageConfig;
}

let envProvider: StorageProvider | null | undefined; // undefined = not yet resolved

export function resolveProvider(
  requestStorage?: RequestStorageConfig,
): StorageProvider | null {
  // Level 1: request-level config
  if (requestStorage) {
    if (requestStorage.provider === "s3" && requestStorage.s3) {
      return new S3StorageProvider(requestStorage.s3);
    }
    if (requestStorage.provider === "local" && requestStorage.local) {
      return new LocalStorageProvider(requestStorage.local);
    }
    return null;
  }

  // Level 2: env-var config (cached singleton)
  if (envProvider !== undefined) {
    return envProvider;
  }

  if (
    config.SCREENSHOT_STORAGE_PROVIDER === "s3" &&
    config.SCREENSHOT_STORAGE_S3_BUCKET &&
    config.SCREENSHOT_STORAGE_S3_ACCESS_KEY_ID &&
    config.SCREENSHOT_STORAGE_S3_SECRET_ACCESS_KEY
  ) {
    envProvider = new S3StorageProvider({
      endpoint: config.SCREENSHOT_STORAGE_S3_ENDPOINT,
      region: config.SCREENSHOT_STORAGE_S3_REGION,
      bucket: config.SCREENSHOT_STORAGE_S3_BUCKET,
      accessKeyId: config.SCREENSHOT_STORAGE_S3_ACCESS_KEY_ID,
      secretAccessKey: config.SCREENSHOT_STORAGE_S3_SECRET_ACCESS_KEY,
      forcePathStyle: !!config.SCREENSHOT_STORAGE_S3_FORCE_PATH_STYLE,
      publicUrl: config.SCREENSHOT_STORAGE_S3_PUBLIC_URL,
      signedUrls: config.SCREENSHOT_STORAGE_URL_MODE === "signed",
      signedUrlTtlSeconds: config.SCREENSHOT_STORAGE_S3_SIGNED_URL_TTL,
      signingEndpoint: config.SCREENSHOT_STORAGE_S3_SIGNING_ENDPOINT,
    });
  } else if (
    config.SCREENSHOT_STORAGE_PROVIDER === "local" &&
    config.SCREENSHOT_STORAGE_LOCAL_DIR
  ) {
    envProvider = new LocalStorageProvider({
      directory: config.SCREENSHOT_STORAGE_LOCAL_DIR,
      publicUrl: config.SCREENSHOT_STORAGE_LOCAL_PUBLIC_URL,
    });
  } else {
    envProvider = null;
  }

  return envProvider;
}
