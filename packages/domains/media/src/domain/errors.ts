export class MediaError extends Error {
  readonly code: string;

  constructor(message: string, code: string = 'MEDIA_ERROR') {
    super(message);
    this.name = 'MediaError';
    this.code = code;
  }
}

export class MediaTooLargeError extends MediaError {
  constructor(maxSize: number, actualSize: number) {
    super(`File size ${actualSize} bytes exceeds maximum allowed limit of ${maxSize} bytes`, 'MEDIA_TOO_LARGE');
    this.name = 'MediaTooLargeError';
  }
}

export class MediaTypeNotAllowedError extends MediaError {
  constructor(typeOrMime: string) {
    super(`Media type or MIME type '${typeOrMime}' is not allowed`, 'MEDIA_TYPE_NOT_ALLOWED');
    this.name = 'MediaTypeNotAllowedError';
  }
}

export class MediaMimeMismatchError extends MediaError {
  constructor(declared: string, detected: string) {
    super(`Declared MIME type '${declared}' does not match detected file signature '${detected}'`, 'MEDIA_MIME_MISMATCH');
    this.name = 'MediaMimeMismatchError';
  }
}

export class MediaInvalidFileError extends MediaError {
  constructor(reason: string) {
    super(`Invalid file: ${reason}`, 'MEDIA_INVALID_FILE');
    this.name = 'MediaInvalidFileError';
  }
}

export class MediaNotFoundError extends MediaError {
  constructor(id: string) {
    super(`Media asset '${id}' not found`, 'MEDIA_NOT_FOUND');
    this.name = 'MediaNotFoundError';
  }
}

export class MediaInUseError extends MediaError {
  readonly referenceCount: number;

  constructor(id: string, referenceCount: number) {
    super(`Media asset '${id}' is currently in use by ${referenceCount} reference(s)`, 'MEDIA_IN_USE');
    this.name = 'MediaInUseError';
    this.referenceCount = referenceCount;
  }
}

export class MediaStorageError extends MediaError {
  constructor(message: string) {
    super(`Storage operation failed: ${message}`, 'MEDIA_STORAGE_ERROR');
    this.name = 'MediaStorageError';
  }
}

export class MediaUploadFailedError extends MediaError {
  constructor(message: string) {
    super(`Media upload failed: ${message}`, 'MEDIA_UPLOAD_FAILED');
    this.name = 'MediaUploadFailedError';
  }
}
