import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { callJst } from "@/lib/jst-api";

const MAX_BATCH_SIZE = 500;

interface SyncItem {
  itemId: string;
  skuId: string;
  skuName?: string;
  barcode?: string;
  salePrice?: number;
  costPrice?: number;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  enabled?: boolean;
}

// POST: Push product changes to JST ERP via /api/Goods/Modify
export async function POST(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!await checkRateLimit(`sync-to-jst:post:${ip}`, 10, 60_000)) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: "Missing or empty items array." }, { status: 400 });
    }

    const items: SyncItem[] = body.items;

    // Validate required fields
    for (const item of items) {
      if (!item.itemId || !item.skuId) {
        return NextResponse.json(
          { error: "Each item must have itemId and skuId." },
          { status: 400 },
        );
      }
    }

    // Batch into chunks of MAX_BATCH_SIZE
    const batches: SyncItem[][] = [];
    for (let i = 0; i < items.length; i += MAX_BATCH_SIZE) {
      batches.push(items.slice(i, i + MAX_BATCH_SIZE));
    }

    const results: { batch: number; response: unknown }[] = [];
    const errors: { batch: number; error: string }[] = [];

    for (let i = 0; i < batches.length; i++) {
      try {
        const jstPayload = batches[i].map((item) => ({
          itemId: item.itemId,
          skuId: item.skuId,
          ...(item.skuName != null && { skuName: item.skuName }),
          ...(item.barcode != null && { barcode: item.barcode }),
          ...(item.salePrice != null && { salePrice: item.salePrice }),
          ...(item.costPrice != null && { costPrice: item.costPrice }),
          ...(item.weight != null && { weight: item.weight }),
          ...(item.length != null && { length: item.length }),
          ...(item.width != null && { width: item.width }),
          ...(item.height != null && { height: item.height }),
          ...(item.enabled != null && { enabled: item.enabled }),
        }));

        const response = await callJst("/api/Goods/Modify", jstPayload);
        results.push({ batch: i + 1, response });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        errors.push({ batch: i + 1, error: message });
      }
    }

    return NextResponse.json({
      ok: errors.length === 0,
      totalItems: items.length,
      totalBatches: batches.length,
      results,
      errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
