import { NextRequest, NextResponse } from "next/server";
import { updateAsset, logEvent, type StreamStatus } from "@/lib/dam-db";
import { streamThumbnailUrl, streamHlsUrl, streamEmbedUrl } from "@/lib/cloudflare-stream";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/server-supabase";

/**
 * POST /api/dam/stream/webhook
 * Called by Cloudflare Stream when a video's status changes.
 *
 * Setup in Cloudflare Dashboard:
 *   Stream → Settings → Webhooks → Add webhook
 *   URL: https://your-domain.com/api/dam/stream/webhook
 *
 * CF Stream sends: { uid, status: { state }, duration, thumbnail, playback }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const uid: string   = body.uid;
    const state: string = body.status?.state ?? "";

    if (!uid) return NextResponse.json({ ok: false, error: "No uid" }, { status: 400 });

    // Find the asset by stream_uid
    const findRes = await fetch(
      `${SUPABASE_URL}/rest/v1/assets?stream_uid=eq.${uid}&limit=1`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Accept-Profile": "dam",
        },
        cache: "no-store",
      }
    );

    if (!findRes.ok) return NextResponse.json({ ok: false }, { status: 200 });
    const rows = await findRes.json();
    if (!rows?.length) return NextResponse.json({ ok: true, skipped: "unknown uid" });

    const asset = rows[0];
    const streamStatus = state as StreamStatus;

    const patch: Record<string, unknown> = {
      stream_status: streamStatus,
    };

    if (state === "ready") {
      patch.status            = "ready";
      patch.stream_hls_url    = streamHlsUrl(uid);
      patch.stream_thumbnail_url = streamThumbnailUrl(uid);
      patch.duration_sec      = body.duration ?? null;
    } else if (state === "error") {
      patch.status = "pending"; // Revert so user can re-try
    }

    await updateAsset(asset.id, patch);
    await logEvent(asset.id, `stream_${state}`, "system", {
      uid,
      duration: body.duration,
      errorCode: body.status?.errorReasonCode,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    // Always return 200 to CF Stream so it doesn't retry indefinitely
    console.error("Stream webhook error:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 200 });
  }
}
