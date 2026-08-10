import { S3ProviderType, S3ProviderPreset, S3StorageConfig } from './types';

export const S3_PRESETS: Record<S3ProviderType, S3ProviderPreset> = {
  'aws-s3': {
    providerType: 'aws-s3',
    displayName: 'Amazon Simple Storage Service (AWS S3)',
    defaultRegion: 'us-east-1',
    requiresCustomEndpoint: false,
    defaultForcePathStyle: false,
    description: 'Industry-standard object storage by Amazon Web Services',
  },
  'cloudflare-r2': {
    providerType: 'cloudflare-r2',
    displayName: 'Cloudflare R2',
    defaultRegion: 'auto',
    requiresCustomEndpoint: true,
    defaultForcePathStyle: true,
    description: 'S3-compatible object storage with zero egress fees by Cloudflare',
  },
  'digitalocean-spaces': {
    providerType: 'digitalocean-spaces',
    displayName: 'DigitalOcean Spaces',
    defaultRegion: 'nyc3',
    defaultEndpointTemplate: 'https://{region}.digitaloceanspaces.com',
    requiresCustomEndpoint: false,
    defaultForcePathStyle: false,
    description: 'S3-compatible object storage by DigitalOcean',
  },
  wasabi: {
    providerType: 'wasabi',
    displayName: 'Wasabi Hot Cloud Storage',
    defaultRegion: 'us-east-1',
    defaultEndpointTemplate: 'https://s3.{region}.wasabisys.com',
    requiresCustomEndpoint: false,
    defaultForcePathStyle: false,
    description: 'Low-cost S3-compatible cloud storage by Wasabi',
  },
  'backblaze-b2': {
    providerType: 'backblaze-b2',
    displayName: 'Backblaze B2 S3 API',
    defaultRegion: 'us-west-004',
    defaultEndpointTemplate: 'https://s3.{region}.backblazeb2.com',
    requiresCustomEndpoint: false,
    defaultForcePathStyle: false,
    description: 'High-performance, low-cost S3-compatible storage by Backblaze',
  },
  hetzner: {
    providerType: 'hetzner',
    displayName: 'Hetzner Object Storage',
    defaultRegion: 'hel1',
    defaultEndpointTemplate: 'https://{region}.your-objectstorage.com',
    requiresCustomEndpoint: false,
    defaultForcePathStyle: false,
    description: 'S3-compatible cloud object storage hosted by Hetzner',
  },
  minio: {
    providerType: 'minio',
    displayName: 'MinIO Object Storage',
    defaultRegion: 'us-east-1',
    defaultEndpointTemplate: 'http://127.0.0.1:9000',
    requiresCustomEndpoint: true,
    defaultForcePathStyle: true,
    description: 'Open-source high performance S3-compatible object storage',
  },
  custom: {
    providerType: 'custom',
    displayName: 'Custom S3-Compatible Provider',
    defaultRegion: 'us-east-1',
    requiresCustomEndpoint: true,
    defaultForcePathStyle: false,
    description: 'Any standard S3-compatible object storage server or gateway',
  },
};

export function resolveS3ConfigWithPreset(config: S3StorageConfig): S3StorageConfig {
  const preset = S3_PRESETS[config.providerType] || S3_PRESETS.custom;
  const region = config.region?.trim() || preset.defaultRegion;

  let endpoint = config.endpoint?.trim();
  if (!endpoint && preset.defaultEndpointTemplate) {
    endpoint = preset.defaultEndpointTemplate.replace('{region}', region);
  }

  const forcePathStyle =
    config.forcePathStyle !== undefined ? config.forcePathStyle : preset.defaultForcePathStyle;

  return {
    ...config,
    region,
    endpoint,
    forcePathStyle,
  };
}
