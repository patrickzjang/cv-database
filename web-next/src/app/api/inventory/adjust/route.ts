import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { callJst } from "@/lib/jst-api";

export async function POST(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!(await checkRateLimit(`inv-adjust:${ip}`, 10, 60_000))) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    if (!body || !body.warehouse_id || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json(
        { error: "Body must include warehouse_id and items array." },
        { status: 400 }
      );
    }

    // Validate items
    for (const item of body.items) {
      if (!item.sku_id || typeof item.sku_id !== "string") {
        return NextResponse.json(
          { error: "Each item must have a sku_id string." },
          { status: 400 }
        );
      }
      if (typeof item.after_qty !== "number" || item.after_qty < 0) {
        return NextResponse.json(
          { error: `Invalid after_qty for ${item.sku_id}.` },
          { status: 400 }
        );
      }
    }

    const jstPayload = {
      warehouse_id: body.warehouse_id,
      items: body.items.map((item: any) => ({
        sku_id: item.sku_id,
        after_qty: item.after_qty,
      })),
    };

    const result = await callJst(
      "/api/Inventory/AdjustWarehouseInventory",
      jstPayload
    );

    return NextResponse.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
