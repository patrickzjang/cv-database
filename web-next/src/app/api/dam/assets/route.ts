import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { listAssets, createAsset, type AssetType, type AssetStatus } from "@/lib/dam-db";
import { logEvent } from "@/lib/dam-db";

export async function GET(req: NextRequest) {
  if (!isAuthenticated(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const sp = req.nextUrl.searchParams;
    const result = await listAssets({
      brand:      sp.get("brand")      || undefined,
      asset_type: (sp.get("type")      || undefined) as AssetType | undefined,
      status:     (sp.get("status")    || undefined) as AssetStatus | undefined,
      q:          sp.get("q")          || undefined,
      page:       Number(sp.get("page"))    || 1,
      pageSize:   Number(sp.get("pageSize")) || 48,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthenticated(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const asset = await createAsset(body);
    await logEvent(asset.id, "uploaded_raw", body.uploaded_by ?? null, {
      filename: body.raw_filename,
      size_bytes: body.raw_size_bytes,
    });
    return NextResponse.json(asset, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
