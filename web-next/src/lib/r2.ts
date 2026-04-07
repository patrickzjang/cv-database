import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const ACCOUNT_ID  = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const ACCESS_KEY  = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || "";
const SECRET_KEY  = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || "";

export const R2_RAW_BUCKET = process.env.R2_RAW_BUCKET || "dam-raw-assets";
export const R2_WEB_BUCKET = process.env.R2_WEB_BUCKET || "dam-web-assets";
export const R2_MAIN_IMAGES_BUCKET = process.env.R2_MAIN_IMAGES_BUCKET || "dam-web-assets";
export const R2_MAIN_IMAGES_PREFIX = "main-images"; // folder inside bucket

/** Build R2 key for main product image (e-commerce). */
export function mainImageKey(brand: string, sku: string, filename: string): string {
  return `${R2_MAIN_IMAGES_PREFIX}/${brand.toUpperCase()}/${sku}/${filename}`;
}

/** Get public URL for main image (if bucket has public access, otherwise use presigned). */
export async function getMainImageUrl(brand: string, sku: string, filename: string): Promise<string> {
  return getDownloadPresignedUrl(R2_MAIN_IMAGES_BUCKET, mainImageKey(brand, sku, filename), undefined, 86400); // 24h
}

export function getR2Client(): S3Client {
  if (!ACCOUNT_ID || !ACCESS_KEY || !SECRET_KEY) {
    throw new Error("Missing Cloudflare R2 credentials");
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  });
}

/** Presigned URL for a browser to PUT a file directly into R2. Expires in 1 hour. */
export async function getUploadPresignedUrl(
  bucket: string,
  key: string,
  contentType: string,
  expiresIn = 3600
): Promise<string> {
  const client = getR2Client();
  return getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
    { expiresIn }
  );
}

/** Presigned URL for a browser to GET (download) a private file from R2. Expires in 1 hour. */
export async function getDownloadPresignedUrl(
  bucket: string,
  key: string,
  filename?: string,
  expiresIn = 3600
): Promise<string> {
  const client = getR2Client();
  const cmd = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ...(filename
      ? { ResponseContentDisposition: `attachment; filename="${filename}"` }
      : {}),
  });
  return getSignedUrl(client, cmd, { expiresIn });
}

/** Delete an object from R2 (server-side only). */
export async function deleteR2Object(bucket: string, key: string): Promise<void> {
  const client = getR2Client();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** Build a canonical R2 object key for a DAM raw asset. */
export function rawKey(brand: string, sku: string, filename: string): string {
  return `${brand.toUpperCase()}/${sku}/${filename}`;
}

/** Build a canonical R2 object key for a DAM web (processed) asset. */
export function webKey(brand: string, sku: string, filename: string): string {
  return `${brand.toUpperCase()}/${sku}/${filename}`;
}
