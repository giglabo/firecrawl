import * as fs from "fs/promises";
import * as path from "path";
import type {
  StorageProvider,
  StorageUploadResult,
} from "../provider.interface";

export interface LocalStorageConfig {
  directory: string; // absolute path inside the container (e.g. /data/screenshots)
  publicUrl?: string; // base URL for constructing download links
}

export class LocalStorageProvider implements StorageProvider {
  private directory: string;
  private publicUrl?: string;

  constructor(cfg: LocalStorageConfig) {
    this.directory = cfg.directory;
    this.publicUrl = cfg.publicUrl?.replace(/\/+$/, "");
  }

  async upload(
    buffer: Buffer,
    key: string,
    contentType: string,
  ): Promise<StorageUploadResult> {
    const filePath = path.join(this.directory, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);

    const url = this.publicUrl
      ? `${this.publicUrl}/${key}`
      : `file://${filePath}`;

    return { url, key, path: `/${key}`, provider: "local" };
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(this.directory, key);
    await fs.unlink(filePath).catch(() => {});
  }
}
