import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getDownloadPresignedUrl, R2_MAIN_IMAGES_BUCKET } from "@/lib/r2";

/**
 * POST /api/main-images/download
 * Body: { key, filename }
 * Returns a presigned URL with Content-Disposition: attachment
 */
export async function POST(req: NextRequest) {
  if (!isAuthenticated(req))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { key, filename } = await req.json();
    if (!key || !key.startsWith("main-images/")) {
      return NextResponse.json({ error: "Invalid key" }, { status: 400 });
    }

    const url = await getDownloadPresignedUrl(
      R2_MAIN_IMAGES_BUCKET,
      key,
      filename || key.split("/").pop() || "image.jpg",
      3600
    );

    return NextResponse.json({ url });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "unknown" }, { status: 500 });
  }
}
