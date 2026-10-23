// Images go straight from the browser to a private S3 bucket using a short-lived, signed upload form.
// The database stores only the S3 key (e.g. "activities/3f2a….webp"); images are served through CloudFront.
import { randomUUID } from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { AppError } from './booking.ts';

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
const MAX_BYTES = 5 * 1024 * 1024;
let s3: S3Client | undefined;

export type UploadFolder = 'activities' | 'tournaments';

export async function signUpload(folder: UploadFolder, contentType: string) {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new AppError('UPLOADS_NOT_CONFIGURED', 503);
  const ext = TYPES[contentType as keyof typeof TYPES];
  if (!ext) throw new AppError('UNSUPPORTED_IMAGE_TYPE');
  s3 ??= new S3Client({ region: process.env.AWS_REGION });
  const key = `${folder}/${randomUUID()}.${ext}`;
  // S3 itself rejects the upload if it is larger than 5 MB or a different type than was signed.
  const { url, fields } = await createPresignedPost(s3, {
    Bucket: bucket, Key: key, Expires: 300,
    Conditions: [['content-length-range', 1, MAX_BYTES], ['eq', '$Content-Type', contentType]],
    Fields: { 'Content-Type': contentType },
  });
  return { url, fields, key };
}

/** Public address of an uploaded image (CloudFront in production). */
export const imageBase = () => process.env.IMAGE_BASE_URL ?? '';
