export class StorageError extends Error {
  constructor(
    message: string,
    public code: string = "STORAGE_ERROR",
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export class StoragePathTraversalError extends StorageError {
  constructor(key: string) {
    super(`Storage path traversal detected for key: ${key}`);
    this.name = "StoragePathTraversalError";
  }
}

export class StorageKeyInvalidError extends StorageError {
  constructor(key: string, reason?: string) {
    super(`Invalid storage key '${key}'${reason ? `: ${reason}` : ""}`);
    this.name = "StorageKeyInvalidError";
  }
}

export class StorageObjectNotFoundError extends StorageError {
  constructor(key: string) {
    super(`Storage object not found for key: ${key}`);
    this.name = "StorageObjectNotFoundError";
  }
}
