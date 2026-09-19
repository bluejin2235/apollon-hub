import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { hasLunaAccess } from "@/lib/luna/beta-access";
import { IMAGE_CORPUS_TOTAL } from "@/lib/luna-admin/primary-constants";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }
  if (!(await hasLunaAccess(admin, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { count, error } = await admin
    .from("luna_media_index")
    .select("path", { count: "exact", head: true });

  if (error) {
    console.error("[luna/limits-stats]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const image_indexed = count ?? 0;
  const image_total = IMAGE_CORPUS_TOTAL;
  const image_pct =
    image_total > 0
      ? Math.round((image_indexed / image_total) * 1000) / 10
      : 0;

  return NextResponse.json({
    success: true,
    image_indexed,
    image_total,
    image_pct
  });
}
