import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { hasLunaAccess } from "@/lib/luna/beta-access";
import {
  clearUserMemo,
  getUserMemory,
  isAnswerLength,
  saveUserMemoText,
  updateAnswerLength
} from "@/lib/luna/user-memory";

export const runtime = "nodejs";

/** GET /api/luna/my-memory — 나의 루나 */
export async function GET(request: NextRequest) {
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

  const memory = await getUserMemory(admin, user.id);
  return NextResponse.json({
    memory: memory
      ? {
          memo: memory.memo,
          answer_length: memory.answer_length,
          source_count: memory.source_count,
          updated_at: memory.updated_at
        }
      : null
  });
}

type PatchBody = {
  memo?: string;
  answer_length?: string;
};

/** PATCH — 고치기(memo) 또는 답 길이 */
export async function PATCH(request: NextRequest) {
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

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.answer_length !== undefined) {
    if (!isAnswerLength(body.answer_length)) {
      return NextResponse.json({ error: "Invalid answer_length" }, { status: 400 });
    }
    const r = await updateAnswerLength(admin, user.id, body.answer_length);
    if (!r.ok) {
      return NextResponse.json({ error: r.error ?? "update failed" }, { status: 500 });
    }
  }

  if (typeof body.memo === "string") {
    const r = await saveUserMemoText(admin, user.id, body.memo);
    if (!r.ok) {
      return NextResponse.json({ error: r.error ?? "save failed" }, { status: 500 });
    }
  }

  const memory = await getUserMemory(admin, user.id);
  return NextResponse.json({
    memory: memory
      ? {
          memo: memory.memo,
          answer_length: memory.answer_length,
          source_count: memory.source_count,
          updated_at: memory.updated_at
        }
      : null
  });
}

/** DELETE — 전부 지우기 */
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

  const r = await clearUserMemo(admin, user.id);
  if (!r.ok) {
    return NextResponse.json({ error: r.error ?? "clear failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
