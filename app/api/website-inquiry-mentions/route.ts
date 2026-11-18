import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { websiteAdminFetch } from "@/lib/website/client";
import {
  resolveNewMentions,
  type InquiryItem,
  type InquiryMemoResult,
  type MentionMember
} from "@/lib/website/contact";
import { applyHubActorHeaders, getHubActor, isMentionEligible } from "@/lib/website/hub-actor";
import { loadMentionTargets, notifyInquiryMentions } from "@/lib/website/inquiry-mentions";

export const runtime = "nodejs";

const MEMO_MAX = 2000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MENTION_IDS_MAX = 50;

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
  // 홈페이지 어드민 권한 + 퇴사자 · 홈페이지테스터 제외 (불리는 사람 목록과 같은 기준)
  if (!isMentionEligible(actor)) {
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

/** 알림 · 메일 제목. 홈페이지 제목이 없으면 고객 이름 대신 접수번호만 쓴다. */
function titleOf(row: InquiryItem): string {
  const title = row.title?.trim();
  if (title) return title;
  return row.receipt_no ? `홈페이지 문의 ${row.receipt_no}` : "홈페이지 문의";
}

function lookupFailed() {
  return NextResponse.json({ error: "mention_lookup_failed" }, { status: 503 });
}

/** 메모에서 @ 로 고를 사람 목록 (이름 · 팀) */
export async function GET(request: NextRequest) {
  const checked = await gate(request);
  if ("error" in checked) return checked.error;
  const targets = await loadMentionTargets(checked.admin);
  if (!targets) return lookupFailed();
  const data: MentionMember[] = targets.map(({ id, name, team }) => ({ id, name, team }));
  return NextResponse.json({ data });
}

/**
 * 내부 메모 저장 + 새로 부른 사람 알림.
 * 이전 메모는 브라우저 값을 믿지 않고 홈페이지에서 다시 읽는다.
 * mentionIds: 목록에서 고른 사람 id. 사람 목록과 메모 속 @이름 으로 서버에서 다시 확인한다.
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
  /** 브라우저가 보고 고친 저장본. 지금 저장본과 다르면 남이 먼저 고친 것이라 덮어쓰지 않는다(코덱스 19차) */
  const expected = typeof record.expected === "string" ? record.expected : null;
  if (!ID_RE.test(inquiryId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const rawIds: unknown[] = Array.isArray(record.mentionIds) ? record.mentionIds : [];
  const mentionIds = [
    ...new Set(
      rawIds.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 64)
    )
  ].slice(0, MENTION_IDS_MAX);

  // 부를 사람 목록을 못 읽으면 저장하지 않고 실패로 돌려준다 (아무도 안 부른 것처럼 보이지 않게)
  const targets = await loadMentionTargets(admin);
  if (!targets) return lookupFailed();

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

  if (expected !== null && (previous.memo ?? "") !== expected) {
    return NextResponse.json({ error: "memo_changed", details: previous }, { status: 409 });
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

  const { ids, ambiguous } = resolveNewMentions({
    previous: previous.memo ?? "",
    next: memo,
    members: targets,
    mentionIds
  });
  const fresh = new Set(ids);

  const deliveries =
    fresh.size > 0
      ? await notifyInquiryMentions(admin, {
          targets: targets.filter((target) => fresh.has(target.id)),
          actorId: user.id,
          actorName: actor.name?.trim() || "허브 사용자",
          inquiryId,
          inquiryTitle: titleOf({
            ...previous,
            ...updated,
            title: updated.title ?? previous.title,
            receipt_no: updated.receipt_no ?? previous.receipt_no
          })
        })
      : [];

  const data: InquiryMemoResult = { item: updated, deliveries, ambiguous };
  return NextResponse.json({ data });
}
