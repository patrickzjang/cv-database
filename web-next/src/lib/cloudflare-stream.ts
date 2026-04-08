const ACCOUNT_ID   = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const STREAM_TOKEN = process.env.CLOUDFLARE_STREAM_API_TOKEN || "";
const STREAM_BASE  = () => `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream`;

function headers() {
  return {
    Authorization: `Bearer ${STREAM_TOKEN}`,
    "Content-Type": "application/json",
  };
}

export interface StreamDirectUploadResult {
  uid: string;
  uploadURL: string;
}

export interface StreamVideoDetails {
  uid: string;
  status: { state: string; errorReasonCode?: string; errorReasonText?: string };
  duration: number;
  thumbnail: string;
  playback: { hls: string; dash: string };
  meta: Record<string, string>;
  created: string;
  modified: string;
}

/**
 * Request a one-time direct upload URL from Cloudflare Stream.
 * The browser uploads directly to the returned uploadURL — no server proxy needed.
 * Expires in 1 hour.
 */
export async function createDirectUploadUrl(params: {
  maxDurationSeconds?: number;
  meta?: Record<string, string>;
}): Promise<StreamDirectUploadResult> {
  if (!ACCOUNT_ID || !STREAM_TOKEN) throw new Error("Missing Cloudflare Stream credentials");

  const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const res = await fetch(`${STREAM_BASE()}/direct_upload`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      maxDurationSeconds: params.maxDurationSeconds ?? 7200, // 2 hrs default
      expiry,
      meta: params.meta ?? {},
    }),
  });

  const json = await res.json();
  if (!json.success) {
    throw new Error(json.errors?.[0]?.message ?? "Cloudflare Stream API error");
  }
  return json.result as StreamDirectUploadResult;
}

/**
 * Fetch current processing status + metadata for a Stream video.
 */
export async function getVideoDetails(uid: string): Promise<StreamVideoDetails> {
  if (!ACCOUNT_ID || !STREAM_TOKEN) throw new Error("Missing Cloudflare Stream credentials");

  const res = await fetch(`${STREAM_BASE()}/${uid}`, { headers: headers() });
  const json = await res.json();
  if (!json.success) throw new Error(json.errors?.[0]?.message ?? "Stream API error");
  return json.result as StreamVideoDetails;
}

/**
 * Delete a video from Cloudflare Stream.
 */
export async function deleteVideo(uid: string): Promise<void> {
  if (!ACCOUNT_ID || !STREAM_TOKEN) throw new Error("Missing Cloudflare Stream credentials");
  await fetch(`${STREAM_BASE()}/${uid}`, { method: "DELETE", headers: headers() });
}

// ─── Public delivery URLs (no auth needed) ───────────────────────────────────

/** Embeddable iframe player URL */
export function streamEmbedUrl(uid: string) {
  return `https://iframe.videodelivery.net/${uid}`;
}

/** HLS manifest URL for native video players */
export function streamHlsUrl(uid: string) {
  return `https://videodelivery.net/${uid}/manifest/video.m3u8`;
}

/** Auto-generated thumbnail/poster frame */
export function streamThumbnailUrl(uid: string, timeSeconds = 0) {
  return `https://videodelivery.net/${uid}/thumbnails/thumbnail.jpg?time=${timeSeconds}s`;
}
