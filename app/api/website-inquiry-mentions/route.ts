import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { canAccessWebsiteAdmin } from "@/lib/auth/website-tester";
import { websiteAdminFetch } from "@/lib/website/client";
import { mentionedMemberNames, type InquiryItem, type MentionMember } from "@/lib/website/contact";
import { applyHubActorHeaders, getHubActor } from "@/lib/website/hub-actor";
import { loadMentionTargets, notifyInquiryMentions } from "@/lib/website/inquiry-mentions";

export const runtime = "nodejs";

const MEMO_MAX = 2000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

async function gate(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return {
      error: NextResponse.json({ error: "Server configuration error" }, { status: 500 })
    } as const;
  }
  const actor = await getHubActor(admin, user.id);
  if (!canAccessWebsiteAdmin(actor.role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  }
  return { user, admin, actor } as const;
}

/** 홈페이지 관리 API 응답에서 문의 한 건을 꺼낸다 ({ data } 또는 본문 그대로) */
function inquiryFromBody(body: unknown): InquiryItem | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const row = "data" in record ? record.data : record;
  if (!row || typeof row !== "object" || !("id" in (row as object))) return null;
  return row as InquiryItem;
}

function titleOf(row: InquiryItem): string {
  const title = row.title?.trim();
  if (title) return title;
  return `${row.name}${row.company ? ` · ${row.company}` : ""} 문의`;
}

/** 메모에서 @ 로 고를 사람 목록 (이름 · 팀) */
export async function GET(request: NextRequest) {
  const checked = await gate(request);
  if ("error" in checked) return checked.error;
  const targets = await loadMentionTargets(checked.admin);
  const data: MentionMember[] = targets.map(({ id, name, team }) => ({ id, name, team }));
  return NextResponse.json({ data });
}

/**
 * 내부 메모 저장 + 새로 부른 사람 알림.
 * 이전 메모는 브라우저 값을 믿지 않고 홈페이지에서 다시 읽는다.
 */
export async function POST(request: NextRequest) {
  const checked = await gate(request);
  if ("error" in checked) return checked.error;
  const { user, admin, actor } = checked;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const inquiryId = typeof record.inquiryId === "string" ? record.inquiryId.trim() : "";
  const memo = typeof record.memo === "string" ? record.memo.slice(0, MEMO_MAX) : "";
  if (!ID_RE.test(inquiryId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const headers = new Headers();
  applyHubActorHeaders(headers, user.id, actor.name);
  const path = `/api/admin/inquiries/${encodeURIComponent(inquiryId)}`;

  const before = await websiteAdminFetch(path, { method: "GET", headers });
  const previous = before.status < 400 ? inquiryFromBody(before.body) : null;
  if (!previous) {
    return NextResponse.json(
      before.body && typeof before.body === "object" ? before.body : { error: "not_found" },
      { status: before.status >= 400 ? before.status : 404 }
    );
  }

  const saved = await websiteAdminFetch(path, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ memo })
  });
  const updated = saved.status < 400 ? inquiryFromBody(saved.body) : null;
  if (!updated) {
    return NextResponse.json(
      saved.body && typeof saved.body === "object" ? saved.body : { error: "save_failed" },
      { status: saved.status >= 400 ? saved.status : 500 }
    );
  }

  const targets = await loadMentionTargets(admin);
  const names = targets.map((target) => target.name);
  const already = new Set(mentionedMemberNames(previous.memo ?? "", names));
  const fresh = new Set(mentionedMemberNames(memo, names).filter((name) => !already.has(name)));

  let result = { notified: [] as string[], mailFailed: [] as string[] };
  if (fresh.size > 0) {
    result = await notifyInquiryMentions(admin, {
      targets: targets.filter((target) => fresh.has(target.name)),
      actorId: user.id,
      actorName: actor.name?.trim() || "허브 사용자",
      inquiryId,
      inquiryTitle: titleOf({ ...previous, ...updated, title: updated.title ?? previous.title }),
      memo
    });
  }

  return NextResponse.json({ data: { item: updated, ...result } });
}
