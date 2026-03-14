export interface StorageUploadResult {
  url: string;
  key: string;
  path: string;
  provider: string;
}

export interface StorageProvider {
  upload(
    buffer: Buffer,
    key: string,
    contentType: string,
  ): Promise<StorageUploadResult>;
  delete?(key: string): Promise<void>;
}
