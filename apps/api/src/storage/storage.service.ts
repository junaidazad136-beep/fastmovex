import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env';

export type Visibility = 'public' | 'private';

/** Abstract so tests (and a future local-disk/GCS driver) can swap it. */
export abstract class StorageService {
  abstract put(visibility: Visibility, key: string, body: Buffer, contentType: string): Promise<void>;
  abstract delete(visibility: Visibility, key: string): Promise<void>;
  /** Short-lived URL for a PRIVATE object (seller documents). */
  abstract signedUrl(key: string, ttlSeconds?: number): Promise<string>;
  /** CDN URL for a PUBLIC object. Null in -> null out. */
  abstract publicUrl(key: string | null | undefined): string | null;
}

@Injectable()
export class S3StorageService extends StorageService {
  private readonly s3: S3Client;
  private readonly buckets: Record<Visibility, string>;
  private readonly mediaBase: string;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.s3 = new S3Client({
      region: config.get('S3_REGION', { infer: true }),
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      // S3-compatible stores (Supabase Storage, R2, MinIO) do not all accept the SDK's optional new checksums
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_ACCESS_KEY', { infer: true }),
      },
    });
    this.buckets = {
      public: config.get('S3_BUCKET_PUBLIC', { infer: true }),
      private: config.get('S3_BUCKET_PRIVATE', { infer: true }),
    };
    this.mediaBase = config.get('PUBLIC_MEDIA_BASE_URL', { infer: true }).replace(/\/+$/, '');
  }

  async put(visibility: Visibility, key: string, body: Buffer, contentType: string) {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.buckets[visibility],
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: visibility === 'public' ? 'public, max-age=31536000, immutable' : 'private, no-store',
        ContentDisposition: visibility === 'private' ? 'attachment' : undefined,
      }),
    );
  }

  async delete(visibility: Visibility, key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.buckets[visibility], Key: key }));
  }

  signedUrl(key: string, ttlSeconds = 300) {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.buckets.private, Key: key }), {
      expiresIn: ttlSeconds,
    });
  }

  publicUrl(key: string | null | undefined) {
    return key ? `${this.mediaBase}/${key}` : null;
  }
}

@Global()
@Module({
  providers: [{ provide: StorageService, useClass: S3StorageService }],
  exports: [StorageService],
})
export class StorageModule {}
