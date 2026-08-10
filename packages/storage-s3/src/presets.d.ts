import { S3ProviderType, S3ProviderPreset, S3StorageConfig } from './types';
export declare const S3_PRESETS: Record<S3ProviderType, S3ProviderPreset>;
export declare function resolveS3ConfigWithPreset(config: S3StorageConfig): S3StorageConfig;
