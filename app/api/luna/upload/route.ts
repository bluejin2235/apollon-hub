import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { hasLunaAccess } from "@/lib/luna/beta-access";

export const runtime = "nodejs";

const BUCKET = "luna-files";
const MAX_BYTES = 32 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
]);

function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim() || "file";
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "file";
}

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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const fileValue = formData.get("file");
  const conversationIdRaw = formData.get("conversation_id");
  const conversationId =
    typeof conversationIdRaw === "string" ? conversationIdRaw.trim() : "";

  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
  }

  if (!(fileValue instanceof File) || fileValue.size === 0) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  if (fileValue.size > MAX_BYTES) {
    return NextResponse.json({ error: "파일은 32MB 이하여야 합니다." }, { status: 400 });
  }

  const mimeType = (fileValue.type || "").toLowerCase();
  if (!ALLOWED_MIME.has(mimeType)) {
    return NextResponse.json(
      { error: "PDF 또는 이미지(png/jpeg/webp/gif)만 업로드할 수 있습니다." },
      { status: 400 }
    );
  }

  const { data: conversation, error: convError } = await admin
    .from("luna_conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (convError) {
    console.error("[luna/upload] conversation", convError);
    return NextResponse.json({ error: convError.message }, { status: 500 });
  }
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const safeName = sanitizeFilename(fileValue.name || "file");
  const storagePath = `${user.id}/${crypto.randomUUID()}-${safeName}`;
  const buffer = Buffer.from(await fileValue.arrayBuffer());

  const { error: uploadError } = await admin.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType: mimeType,
    upsert: false
  });

  if (uploadError) {
    console.error("[luna/upload] storage", uploadError);
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: row, error: insertError } = await admin
    .from("luna_attachments")
    .insert({
      user_id: user.id,
      conversation_id: conversationId,
      storage_path: storagePath,
      file_name: fileValue.name || safeName,
      mime_type: mimeType,
      size_bytes: fileValue.size
    })
    .select("id, file_name, mime_type, size_bytes, storage_path")
    .single();

  if (insertError || !row) {
    console.error("[luna/upload] insert", insertError);
    await admin.storage.from(BUCKET).remove([storagePath]);
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to save attachment" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    id: row.id as string,
    file_name: row.file_name as string,
    mime_type: row.mime_type as string,
    size_bytes: row.size_bytes as number,
    storage_path: row.storage_path as string
  });
}

type DeleteBody = { id?: string };

export async function DELETE(request: NextRequest) {
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

  let body: DeleteBody;
  try {
    body = (await request.json()) as DeleteBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { data: row, error: fetchError } = await admin
    .from("luna_attachments")
    .select("id, user_id, storage_path")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    console.error("[luna/upload] fetch", fetchError);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!row || row.user_id !== user.id) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  const storagePath = row.storage_path as string;
  const { error: removeError } = await admin.storage.from(BUCKET).remove([storagePath]);
  if (removeError) {
    console.error("[luna/upload] remove storage", removeError);
  }

  const { error: deleteError } = await admin.from("luna_attachments").delete().eq("id", id);
  if (deleteError) {
    console.error("[luna/upload] delete row", deleteError);
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
