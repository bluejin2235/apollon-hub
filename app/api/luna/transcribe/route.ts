import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { hasLunaAccess } from "@/lib/luna/beta-access";
import { transcribeAudio } from "@/lib/luna/transcribe";

export const runtime = "nodejs";

const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }
  if (!(await hasLunaAccess(admin, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size < 200) {
    return NextResponse.json({ error: "audio required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "audio too large" }, { status: 413 });
  }
  const secondsRaw = form.get("seconds");
  const seconds =
    typeof secondsRaw === "string" && Number.isFinite(Number(secondsRaw))
      ? Number(secondsRaw)
      : undefined;
  const filename =
    file instanceof File && file.name ? file.name : "audio.webm";

  try {
    const result = await transcribeAudio({
      admin,
      file,
      filename,
      seconds,
      userId: user.id
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[luna/transcribe]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "transcribe failed" },
      { status: 502 }
    );
  }
}
