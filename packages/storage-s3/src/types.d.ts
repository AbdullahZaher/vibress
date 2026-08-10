export type S3ProviderType = 'aws-s3' | 'cloudflare-r2' | 'digitalocean-spaces' | 'wasabi' | 'backblaze-b2' | 'hetzner' | 'minio' | 'custom';
export interface S3StorageConfig {
    id?: string | undefined;
    name?: string | undefined;
    providerType: S3ProviderType;
    endpoint?: string | undefined;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle?: boolean | undefined;
    publicBaseUrl?: string | undefined;
    defaultAcl?: string | undefined;
    signedUrlTtlSeconds?: number | undefined;
}
export interface S3ProviderPreset {
    providerType: S3ProviderType;
    displayName: string;
    defaultRegion: string;
    defaultEndpointTemplate?: string;
    requiresCustomEndpoint: boolean;
    defaultForcePathStyle: boolean;
    description: string;
}
