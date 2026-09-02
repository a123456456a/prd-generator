export interface StoredFile {
  storageKey: string;
  originalName: string;
  mimeType: string;
  size: number;
  absolutePath: string;
}

export interface Storage {
  save(input: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
  }): Promise<StoredFile>;
  read(storageKey: string): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
}
