export interface StorageUploadResult {
  url: string;
  key: string;
  path: string;
  provider: string;
}

export interface StorageFetchResult {
  body: Buffer;
  contentType?: string;
}

export interface StorageProvider {
  upload(
    buffer: Buffer,
    key: string,
    contentType: string,
  ): Promise<StorageUploadResult>;
  delete?(key: string): Promise<void>;
  // Required by SCREENSHOT_STORAGE_URL_MODE=proxy, which reads the object back
  // out through the API instead of linking to it directly.
  fetch?(key: string): Promise<StorageFetchResult | null>;
}
