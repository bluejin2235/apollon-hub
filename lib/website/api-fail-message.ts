/** DB / API 실패를 사람이 읽는 말로 바꿉니다. 원문 code·JSON 은 노출하지 않습니다. */

export type ApiFailContext = {
  /** 한 줄 요약 국문 — 비었는지 판단 */
  summaryKo?: string | null;
  /** 대체 텍스트 국문 */
  keyAltKo?: string | null;
};

const FALLBACK_SAVE = "저장하지 못했습니다. 빠진 값이 있는지 확인해 주세요";
const MSG_SUMMARY = "한 줄 요약을 넣어 주세요";
const MSG_ALT = "대체 텍스트를 넣어 주세요";

function detailsRecord(details: unknown): Record<string, unknown> | null {
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  return details as Record<string, unknown>;
}

function blobOf(error: string, details?: unknown): string {
  const rec = detailsRecord(details);
  const message =
    (typeof rec?.message === "string" && rec.message) ||
    (typeof rec?.details === "string" && rec.details) ||
    "";
  const code = typeof rec?.code === "string" ? rec.code : "";
  const hint = typeof rec?.hint === "string" ? rec.hint : "";
  return `${error} ${message} ${code} ${hint} ${JSON.stringify(details ?? "")}`;
}

function publishReadyMessage(ctx?: ApiFailContext): string {
  const missing: string[] = [];
  if (ctx) {
    if (!ctx.summaryKo?.trim()) missing.push(MSG_SUMMARY);
    if (!ctx.keyAltKo?.trim()) missing.push(MSG_ALT);
  }
  if (missing.length > 0) return missing.join(" · ");
  // 국문은 있는데도 제약이 막으면(예: 예전 영문 필수) 뭉뚱그리지 않고 안내
  if (ctx) {
    return "공개하려면 한 줄 요약과 대체 텍스트(국문)를 확인해 주세요";
  }
  return `${MSG_SUMMARY} · ${MSG_ALT}`;
}

/** 알려진 CHECK / FK / NOT NULL 이름을 한국어로 */
export function friendlyDbConstraintMessage(
  error: string,
  details?: unknown,
  ctx?: ApiFailContext
): string | null {
  const rec = detailsRecord(details);
  const code = typeof rec?.code === "string" ? rec.code : "";
  const blob = blobOf(error, details);

  if (/works_key_image_ratio|insights_key_image_ratio/i.test(blob)) {
    return "대표 이미지가 16:9 가 아닙니다";
  }
  if (/works_publish_ready|insights_publish_ready/i.test(blob)) {
    return publishReadyMessage(ctx);
  }
  if (/work_credits_name_ko|credits_name_ko/i.test(blob)) {
    return "이름 국문은 필수입니다";
  }
  if (/works_card_image_source/i.test(blob)) {
    return "썸네일 이미지 출처 값이 올바르지 않습니다";
  }
  if (/works_slug|insights_slug|unique.*slug/i.test(blob) || code === "23505") {
    if (/slug/i.test(blob)) return "이미 쓰인 주소입니다. 다른 주소를 넣어 주세요";
    return "이미 있는 값과 겹칩니다";
  }
  if (code === "23503" || /foreign key|violates foreign key/i.test(blob)) {
    return "연결된 항목을 찾을 수 없습니다. 삭제되었거나 잘못된 참조입니다";
  }
  if (code === "23502" || /null value in column|not-null/i.test(blob)) {
    return FALLBACK_SAVE;
  }
  if (code === "23514" || /check constraint|violates check/i.test(blob)) {
    return FALLBACK_SAVE;
  }
  if (error === "database_error" || /database_error/i.test(blob)) {
    return FALLBACK_SAVE;
  }
  return null;
}

const KNOWN_API_ERRORS: Record<string, string> = {
  unauthorized: "로그인이 필요합니다",
  forbidden: "권한이 없습니다",
  not_found: "찾을 수 없습니다",
  work_not_found: "워크를 찾을 수 없습니다",
  insight_not_found: "인사이트를 찾을 수 없습니다",
  content_not_found: "콘텐츠를 찾을 수 없습니다",
  network_error: "연결이 끊어졌습니다",
  website_timeout: "홈페이지 서버 응답이 없습니다. 잠시 뒤 다시 시도해 주세요",
  website_unreachable: "홈페이지 서버에 연결하지 못했습니다",
  request_failed: "요청을 처리하지 못했습니다",
  publish_blocked: "공개하려면 점검 항목을 채워 주세요",
  invalid_body: "보낸 값이 올바르지 않습니다",
  invalid_patch: "수정할 값이 올바르지 않습니다"
};

function looksLikeRawDbDump(text: string): boolean {
  return /235\d{2}|check constraint|violates|database_error|new row for relation|PGRST/i.test(
    text
  );
}

export function apiFailMessage(
  res: { error: string; details?: unknown },
  ctx?: ApiFailContext
): string {
  const mapped = friendlyDbConstraintMessage(res.error, res.details, ctx);
  if (mapped) return mapped;

  const known = KNOWN_API_ERRORS[res.error];
  if (known) {
    if (res.error === "publish_blocked") {
      const fromFlags = publishBlockedFromDetails(res.details, ctx);
      if (fromFlags) return fromFlags;
    }
    return known;
  }

  const rec = detailsRecord(res.details);
  if (rec) {
    const message = typeof rec.message === "string" ? rec.message.trim() : "";
    if (message) {
      const fromMessage = friendlyDbConstraintMessage(res.error, res.details, ctx);
      if (fromMessage) return fromMessage;
      if (looksLikeRawDbDump(message) || looksLikeRawDbDump(JSON.stringify(rec))) {
        return FALLBACK_SAVE;
      }
      // 이미 사람 말인 서버 메시지
      if (!looksLikeRawDbDump(message)) return message;
    }
  }

  if (looksLikeRawDbDump(res.error)) return FALLBACK_SAVE;
  if (/^[a-z][a-z0-9_]*$/i.test(res.error)) {
    return FALLBACK_SAVE;
  }
  return res.error || FALLBACK_SAVE;
}

function publishBlockedFromDetails(details: unknown, ctx?: ApiFailContext): string | null {
  const rec = detailsRecord(details);
  if (!rec) return publishReadyMessage(ctx);

  const flags = Object.entries(rec)
    .filter(([, v]) => v === true)
    .map(([k]) => k);

  const parts: string[] = [];
  if (flags.includes("missing_summary_en") || flags.includes("missing_summary")) {
    parts.push(MSG_SUMMARY);
  }
  if (flags.includes("missing_key_alt")) {
    parts.push(MSG_ALT);
  }
  if (parts.length > 0) return parts.join(" · ");

  // 플래그만 있고 요약/알트가 실제로 비었으면 국문 기준으로
  if (ctx && (!ctx.summaryKo?.trim() || !ctx.keyAltKo?.trim())) {
    return publishReadyMessage(ctx);
  }
  return null;
}

export const PUBLISH_MSG_SUMMARY = MSG_SUMMARY;
export const PUBLISH_MSG_ALT = MSG_ALT;
