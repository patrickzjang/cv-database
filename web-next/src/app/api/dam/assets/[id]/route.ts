import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getAsset, updateAsset, getAssetEvents, logEvent } from "@/lib/dam-db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthenticated(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const [asset, events] = await Promise.all([getAsset(id), getAssetEvents(id)]);
    if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ asset, events });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthenticated(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const body = await req.json();
    const actor: string = body._actor ?? "system";

    // Remove internal fields from patch
    const { _actor, ...patch } = body;

    // If approving, stamp approved_by + approved_at
    if (patch.status === "approved" && !patch.approved_by) {
      patch.approved_by = actor;
      patch.approved_at = new Date().toISOString();
    }

    const asset = await updateAsset(id, patch);

    // Log meaningful events
    if (patch.status) {
      const eventMap: Record<string, string> = {
        approved: "approved",
        archived: "archived",
        ready:    "marked_ready",
      };
      if (eventMap[patch.status]) {
        await logEvent(id, eventMap[patch.status], actor, { status: patch.status });
      }
    }

    return NextResponse.json(asset);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
