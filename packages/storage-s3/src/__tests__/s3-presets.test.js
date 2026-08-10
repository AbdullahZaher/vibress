import { describe, it, expect } from 'vitest';
import { resolveS3ConfigWithPreset } from '../presets';
describe('S3 Storage Presets', () => {
    it('should return correct defaults for AWS S3', () => {
        const config = resolveS3ConfigWithPreset({
            providerType: 'aws-s3',
            region: 'us-west-2',
            bucket: 'my-bucket',
            accessKeyId: 'key',
            secretAccessKey: 'secret',
        });
        expect(config.region).toBe('us-west-2');
        expect(config.forcePathStyle).toBe(false);
    });
    it('should set forcePathStyle true for Cloudflare R2 and MinIO presets', () => {
        const r2Config = resolveS3ConfigWithPreset({
            providerType: 'cloudflare-r2',
            region: 'auto',
            bucket: 'r2-bucket',
            endpoint: 'https://acc.r2.cloudflarestorage.com',
            accessKeyId: 'key',
            secretAccessKey: 'secret',
        });
        expect(r2Config.forcePathStyle).toBe(true);
        const minioConfig = resolveS3ConfigWithPreset({
            providerType: 'minio',
            region: 'us-east-1',
            bucket: 'minio-bucket',
            accessKeyId: 'minio',
            secretAccessKey: 'minio123',
        });
        expect(minioConfig.endpoint).toBe('http://127.0.0.1:9000');
        expect(minioConfig.forcePathStyle).toBe(true);
    });
    it('should resolve templates for DigitalOcean, Wasabi, Backblaze B2, Hetzner', () => {
        const spaces = resolveS3ConfigWithPreset({
            providerType: 'digitalocean-spaces',
            region: 'sfo3',
            bucket: 'bkt',
            accessKeyId: 'k',
            secretAccessKey: 's',
        });
        expect(spaces.endpoint).toBe('https://sfo3.digitaloceanspaces.com');
        const wasabi = resolveS3ConfigWithPreset({
            providerType: 'wasabi',
            region: 'eu-central-1',
            bucket: 'bkt',
            accessKeyId: 'k',
            secretAccessKey: 's',
        });
        expect(wasabi.endpoint).toBe('https://s3.eu-central-1.wasabisys.com');
        const b2 = resolveS3ConfigWithPreset({
            providerType: 'backblaze-b2',
            region: 'us-west-004',
            bucket: 'bkt',
            accessKeyId: 'k',
            secretAccessKey: 's',
        });
        expect(b2.endpoint).toBe('https://s3.us-west-004.backblazeb2.com');
        const hetzner = resolveS3ConfigWithPreset({
            providerType: 'hetzner',
            region: 'fsn1',
            bucket: 'bkt',
            accessKeyId: 'k',
            secretAccessKey: 's',
        });
        expect(hetzner.endpoint).toBe('https://fsn1.your-objectstorage.com');
    });
});
//# sourceMappingURL=s3-presets.test.js.map