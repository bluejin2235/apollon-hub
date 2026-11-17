import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { canAccessWebsiteAdmin } from "@/lib/auth/website-tester";
import {
  isAllowedWebsiteImageUrl,
  suggestAlt
} from "@/lib/website/alt-suggest";
import { readAltSuggestContext } from "@/lib/website/alt-suggest-context";
import { getHubActor } from "@/lib/website/hub-actor";

export const runtime = "nodejs";

/*
 * 한도 주의 (2026-11-17 코덱스 검토 · 팀장 판단으로 보류):
 * 동시 3건 · 하루 300건 · 실패/성공 캐시는 서버 프로세스 메모리에만 있다.
 * 서버가 여러 개로 뜨면 서버마다 따로 세고, 재시작하면 0 부터 다시 센다.
 * 관리자 로그인이 있어야 부를 수 있고 1건 약 0.0026달러라 이번엔 고치지 않는다.
 * 고칠 때는 공유 저장소의 원자적 하루 카운터 · 동시 실행 임대 · 만료 캐시로 바꾼다.
 */
const MAX_PARALLEL = 3;
const MAX_PER_DAY = 300;
const FAIL_TTL_MS = 10 * 60 * 1000;

/** 같은 이미지 URL · 하루 성공 캐시 */
const dayCache = new Map<string, { day: string; ko: string; en: string }>();
/** 실패 URL · 10분 */
const failCache = new Map<string, number>();

let inFlight = 0;
let dayKey = "";
let dayCount = 0;

function kstDayKey(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function bumpDayCounter() {
  const day = kstDayKey();
  if (day !== dayKey) {
    dayKey = day;
    dayCount = 0;
  }
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}


function rememberFail(imageUrl: string) {
  failCache.set(imageUrl, Date.now() + FAIL_TTL_MS);
  if (failCache.size > 500) {
    const now = Date.now();
    for (const [key, exp] of failCache) {
      if (exp <= now) failCache.delete(key);
    }
  }
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

  const actor = await getHubActor(admin, user.id);
  if (!canAccessWebsiteAdmin(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const imageUrl = asString(rec?.imageUrl);
  const context = readAltSuggestContext(rec?.context);

  if (!imageUrl || !context) {
    return NextResponse.json(
      { data: null, error: "invalid_input", reason: "이미지 주소나 글 정보가 부족합니다" },
      { status: 400 }
    );
  }

  if (!isAllowedWebsiteImageUrl(imageUrl)) {
    return NextResponse.json(
      { data: null, error: "url_not_allowed", reason: "우리 저장소 이미지만 설명할 수 있습니다" },
      { status: 400 }
    );
  }

  const day = kstDayKey();
  const cached = dayCache.get(imageUrl);
  if (cached && cached.day === day) {
    return NextResponse.json({ data: { ko: cached.ko, en: cached.en }, cached: true });
  }

  const failUntil = failCache.get(imageUrl) ?? 0;
  if (failUntil > Date.now()) {
    return NextResponse.json({
      data: null,
      error: "suggest_failed",
      reason: "자동 설명을 못 썼어요. 직접 써 주세요"
    });
  }

  bumpDayCounter();
  if (dayCount >= MAX_PER_DAY) {
    return NextResponse.json(
      { data: null, error: "rate_limited", reason: "오늘은 자동 설명을 더 만들 수 없습니다" },
      { status: 429 }
    );
  }
  if (inFlight >= MAX_PARALLEL) {
    return NextResponse.json(
      { data: null, error: "busy", reason: "잠시 뒤에 다시 시도해 주세요" },
      { status: 429 }
    );
  }

  inFlight += 1;
  dayCount += 1;
  try {
    const result = await suggestAlt({ imageUrl, context });
    if (!result) {
      rememberFail(imageUrl);
      return NextResponse.json({
        data: null,
        error: "suggest_failed",
        reason: "자동 설명을 못 썼어요. 직접 써 주세요"
      });
    }

    dayCache.set(imageUrl, { day, ko: result.ko, en: result.en });
    failCache.delete(imageUrl);
    if (dayCache.size > 500) {
      for (const [key, value] of dayCache) {
        if (value.day !== day) dayCache.delete(key);
      }
    }

    return NextResponse.json({ data: result, cached: false });
  } finally {
    inFlight = Math.max(0, inFlight - 1);
  }
}
