export type InquiryFilter = "all" | "unread" | "pending" | "done";

export type InquiryItem = {
  id: string;
  kind: string;
  name: string;
  company: string | null;
  email: string;
  phone: string | null;
  budget: string | null;
  timeline: string | null;
  message: string | null;
  locale: string;
  is_read: boolean;
  replied_at: string | null;
  memo: string | null;
  created_at: string;
  /** Let's Talk 접수번호. 옛 문의 양식은 null (홈페이지가 아직 안 주면 없음) */
  receipt_no?: string | null;
  submit_state?: string | null;
  missing_files?: string[] | null;
  /** 읽기 쉬운 제목 (예: "예시주식회사, 성수동 · 상업시설 미디어 설치"). 홈페이지가 아직 안 주면 없음 */
  title?: string | null;
  /** 메일과 같은 구조의 구역 (프로젝트 · 연락처). 옛 문의는 null */
  sections?: InquirySection[] | null;
  /** 고객이 직접 쓴 글만 */
  text?: string | null;
};

export type InquirySection = { title: string; rows: [string, string][] };

/** Let's Talk 문의인지 (첨부 조회 대상) */
export function isLetsTalkInquiry(item: InquiryItem): boolean {
  return Boolean(item.receipt_no) || Boolean(item.sections && item.sections.length > 0);
}

/** 목록·상세 제목: 홈페이지가 준 제목, 없으면 내용 앞부분 */
export function inquiryTitle(item: InquiryItem, max = 48): string {
  const title = item.title?.trim();
  if (title) return title;
  return messagePreview(item.message, max) || `${item.name} 님 문의`;
}

export type InquiryStatus = "unread" | "pending" | "done";

export function inquiryStatus(item: InquiryItem): InquiryStatus {
  if (item.replied_at) return "done";
  return item.is_read ? "pending" : "unread";
}

export const INQUIRY_STATUS_LABEL: Record<InquiryStatus, string> = {
  unread: "안 읽음",
  pending: "미처리",
  done: "처리 완료"
};

/** @ 앞뒤 경계: 글 처음 · 끝, 빈칸, 문장부호 · 기호 */
const MENTION_EDGE = /[\s\p{P}\p{S}]/u;

function isMentionEdge(ch: string | undefined): boolean {
  return ch === undefined || MENTION_EDGE.test(ch);
}

/**
 * 메모에서 @이름 이 몇 번 나오는지 센다.
 * 앞은 글 처음 · 빈칸 · 문장부호, 뒤는 글 끝 · 빈칸 · 문장부호여야 한다
 * (vendor@ann.example 은 부른 것이 아니다). 같은 자리에서는 가장 긴 이름을 고른다.
 */
export function countMentionTokens(text: string, names: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  const sorted = [...new Set(names.map((name) => name.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length
  );
  if (sorted.length === 0 || !text) return counts;
  let index = text.indexOf("@");
  while (index !== -1) {
    if (isMentionEdge(text[index - 1])) {
      const start = index + 1;
      const hit = sorted.find(
        (name) => text.startsWith(name, start) && isMentionEdge(text[start + name.length])
      );
      if (hit) counts.set(hit, (counts.get(hit) ?? 0) + 1);
    }
    index = text.indexOf("@", index + 1);
  }
  return counts;
}

/** 메모에서 부른 사람 이름 (중복 없이) */
export function mentionedMemberNames(text: string, names: string[]): string[] {
  return [...countMentionTokens(text, names).keys()];
}

/** @ 로 고를 수 있는 허브 사람 */
export type MentionMember = { id: string; name: string; team: string | null };

/**
 * 이번 저장으로 새로 부른 사람.
 * - mentionIds: 목록에서 고른 사람 id. 그 사람의 @이름 이 메모에 남아 있어야 한다.
 * - id 없이 손으로 쓴 @이름: 그 이름이 한 사람뿐일 때만 부른다.
 *   같은 이름이 여럿이면 아무도 부르지 않고 ambiguous 로 돌려준다.
 * - 이전 메모보다 @이름 이 늘어난 이름만 새로 부른 것으로 본다.
 */
export function resolveNewMentions(opts: {
  previous: string;
  next: string;
  members: MentionMember[];
  mentionIds?: string[];
}): { ids: string[]; ambiguous: string[] } {
  const names = opts.members.map((member) => member.name);
  const before = countMentionTokens(opts.previous, names);
  const after = countMentionTokens(opts.next, names);
  const byId = new Map(opts.members.map((member) => [member.id, member]));

  const chosenByName = new Map<string, Set<string>>();
  for (const id of opts.mentionIds ?? []) {
    const member = byId.get(id);
    if (!member) continue;
    const name = member.name.trim();
    if (!after.get(name)) continue;
    const set = chosenByName.get(name) ?? new Set<string>();
    set.add(member.id);
    chosenByName.set(name, set);
  }

  const ids = new Set<string>();
  const ambiguous: string[] = [];
  for (const [name, count] of after) {
    if (count <= (before.get(name) ?? 0)) continue;
    const chosen = chosenByName.get(name);
    if (chosen) {
      for (const id of chosen) ids.add(id);
      continue;
    }
    const same = opts.members.filter((member) => member.name.trim() === name);
    if (same.length === 1) ids.add(same[0].id);
    else if (same.length > 1) ambiguous.push(name);
  }
  return { ids: [...ids], ambiguous };
}

/** 메일은 회사 주소로만 보낸다. 프로필 메일은 본인이 바꿀 수 있다. */
export const COMPANY_EMAIL_DOMAIN = "apollonworks.com";

export function isCompanyEmail(email: string | null | undefined): boolean {
  const value = (email ?? "").trim().toLowerCase();
  const at = value.indexOf("@");
  if (at <= 0 || value.lastIndexOf("@") !== at) return false;
  return value.slice(at + 1) === COMPANY_EMAIL_DOMAIN;
}

/** 알림 길 하나의 결과 */
export type MentionChannel = "ok" | "failed" | "skipped";

/** 부른 사람 한 명에게 보낸 결과 (허브 알림 · 메일 따로) */
export type MentionDelivery = {
  id: string;
  name: string;
  hub: MentionChannel;
  email: MentionChannel;
  /** recent: 2분 안에 같은 문의로 이미 알림 · not_company: 회사 메일 아님 · no_email: 메일 없음 */
  skipReason?: "recent" | "not_company" | "no_email";
};

/** 메모 저장 결과 */
export type InquiryMemoResult = {
  item: InquiryItem;
  deliveries: MentionDelivery[];
  /** 같은 이름이 여럿이라 아무에게도 알리지 않은 이름 */
  ambiguous: string[];
};

/** 메모 저장 뒤 알림 결과 문구 (허브 알림 · 메일을 따로 알린다) */
export function mentionSaveMessage(result: {
  deliveries?: MentionDelivery[];
  ambiguous?: string[];
}): { message: string; tone: "ok" | "warn" } {
  const deliveries = result.deliveries ?? [];
  const ambiguous = result.ambiguous ?? [];
  const namesOf = (test: (d: MentionDelivery) => boolean) =>
    deliveries
      .filter(test)
      .map((d) => d.name)
      .join(", ");
  const hubOk = namesOf((d) => d.hub === "ok");
  const hubFailed = namesOf((d) => d.hub === "failed");
  const mailOk = namesOf((d) => d.email === "ok");
  const mailFailed = namesOf((d) => d.email === "failed");
  const mailSkipped = namesOf((d) => d.skipReason === "not_company" || d.skipReason === "no_email");
  const recent = namesOf((d) => d.skipReason === "recent");
  const parts: string[] = [];
  if (hubOk) parts.push(`허브 알림 보냄: ${hubOk}`);
  if (hubFailed) parts.push(`허브 알림 실패: ${hubFailed}`);
  if (mailOk) parts.push(`메일 보냄: ${mailOk}`);
  if (mailFailed) parts.push(`메일 실패: ${mailFailed}`);
  if (mailSkipped) parts.push(`회사 메일 주소가 없어 메일은 안 보냄: ${mailSkipped}`);
  if (recent) parts.push(`2분 안에 같은 알림을 받아 건너뜀: ${recent}`);
  if (ambiguous.length > 0) {
    parts.push(
      `같은 이름이 여럿이라 아무에게도 안 알림: ${ambiguous
        .map((name) => `@${name}`)
        .join(", ")}. 목록에서 골라 다시 불러 주세요`
    );
  }
  if (parts.length === 0) return { message: "메모를 저장했습니다", tone: "ok" };
  const warn = Boolean(hubFailed || mailFailed || ambiguous.length > 0);
  return { message: `메모를 저장했습니다. ${parts.join(". ")}`, tone: warn ? "warn" : "ok" };
}

export type InquiryFile = {
  /** 홈페이지가 주는 파일 고유 id. 옛 응답에는 없다 */
  id?: string | null;
  name: string;
  size: number;
  url: string | null;
};
export type InquiryFiles = { items: InquiryFile[]; missing: string[] };

/** 첨부 key: id, 없으면 이름 + 순서 */
export function inquiryFileKey(file: InquiryFile, index: number): string {
  return file.id ? `id:${file.id}` : `name:${file.name}#${index}`;
}

/** 새로 받은 첨부 목록에서 누른 파일을 다시 찾는다 (id 먼저, 없으면 이름 + 순서, 그다음 이름) */
export function findInquiryFile(
  items: InquiryFile[],
  ref: { id?: string | null; name: string; index: number }
): InquiryFile | undefined {
  if (ref.id) return items.find((file) => file.id === ref.id);
  const same = items[ref.index];
  if (same && same.name === ref.name) return same;
  return items.find((file) => file.name === ref.name);
}

/**
 * 지금 탭에서 열어도 페이지가 바뀌지 않고 내려받게 되는 주소.
 * 홈페이지가 주는 서명 주소에는 download= 가 붙어 있어 파일로 내려받아진다. 없으면 붙인다.
 * http(s) 주소가 아니면 null: 지금 탭에서 열지 않는다.
 */
export function inquiryDownloadUrl(url: string, name: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  // 이미 있으면 받은 주소를 그대로 쓴다(서명 글자를 다시 바꿔 쓰지 않게)
  if (parsed.searchParams.has("download")) return url;
  parsed.searchParams.set("download", name);
  return parsed.toString();
}

/**
 * 저장이 끝난 문의 한 줄을 지금 목록에 바로 반영한다(새로 고침이 실패해도 목록이 옛 표시로 남지 않게).
 * 줄의 읽음 · 답장 표시를 바꾸고, 안 읽음이 읽음으로(또는 반대로) 바뀌었으면 「안 읽은 문의」 수도 맞춘다.
 * 목록에 없는 문의면 목록을 그대로 돌려준다.
 */
export function applyInquiryToList(list: InquiryList | null, row: InquiryItem): InquiryList | null {
  if (!list) return list;
  const at = list.items.findIndex((item) => item.id === row.id);
  if (at < 0) return list;
  const before = list.items[at];
  const after = { ...before, ...row };
  const items = list.items.slice();
  items[at] = after;
  const unreadChange = (before.is_read ? 0 : 1) - (after.is_read ? 0 : 1);
  return {
    items,
    summary: { ...list.summary, unread: Math.max(0, list.summary.unread - unreadChange) }
  };
}

/** 목록 · 사람 목록처럼 받아 오는 자료의 상태. 길이로 짐작하지 않는다(빈 목록도 받은 것) */
export type LoadState = "loading" | "ready" | "error";

/**
 * 문의 목록 칸에 무엇을 그리나.
 * 받기 전 · 실패를 「문의가 없습니다」로 보이지 않는다. 검색 · 거르기를 바꾸면 맞는 응답이 올 때까지 loading.
 */
export function inquiryListView(
  state: LoadState,
  count: number,
  searching: boolean
): "items" | "loading" | "error" | "empty-search" | "empty" {
  if (state === "loading") return "loading";
  if (state === "error") return "error";
  if (count > 0) return "items";
  return searching ? "empty-search" : "empty";
}

/** 요약 칸 글: 받은 뒤에만 숫자. 받기 전 「불러오는 중」, 실패면 「불러오지 못함」(0 으로 보이지 않게) */
export function inquirySummaryText(state: LoadState, value: number | null | undefined): string {
  if (state === "loading") return "불러오는 중";
  if (state === "error" || value == null) return "불러오지 못함";
  return value.toLocaleString("ko-KR");
}

/**
 * 메모 @부르기 칸 안내 글. 고를 사람이 있으면 null.
 * 받는 중 · 실패 · 받았는데 사람이 없음 · 찾는 이름이 없음을 나눈다(빈 목록을 「불러오는 중」으로 두지 않는다)
 */
export function mentionPickerText(state: LoadState, memberCount: number, optionCount: number): string | null {
  if (state === "loading") return "사람 목록을 불러오는 중…";
  if (state === "error") return "사람 목록을 불러오지 못했습니다";
  if (optionCount > 0) return null;
  return memberCount === 0 ? "부를 수 있는 사람이 없습니다" : "맞는 사람이 없습니다";
}

/** 고객이 쓴 글: text, 없으면 message */
export function customerTextOf(item: InquiryItem): string | null {
  if (typeof item.text === "string") return item.text;
  return item.message;
}

export function fileSizeLabel(bytes: number): string {
  if (bytes < 100 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  const mb = bytes / (1024 * 1024);
  return mb >= 10 ? `${Math.round(mb)}MB` : `${Math.round(mb * 10) / 10}MB`;
}

export type InquiryList = {
  items: InquiryItem[];
  summary: { unread: number; thisMonth: number; pending: number };
};

export const INQUIRY_FILTERS: { id: InquiryFilter; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "unread", label: "안 읽음" },
  { id: "pending", label: "미처리" },
  { id: "done", label: "처리 완료" }
];

const BUDGET_LABEL: Record<string, string> = {
  undecided: "미정",
  under1: "1억 미만",
  "1to3": "1–3억",
  "3to5": "3–5억",
  "5to10": "5–10억",
  over10: "10억 이상"
};

export function budgetLabel(value: string | null | undefined): string {
  if (!value) return "없음";
  return BUDGET_LABEL[value] ?? value;
}

export function timelineLabel(value: string | null | undefined): string {
  if (!value) return "없음";
  if (value === "undecided") return "미정";
  if (value === "later") return "그 이후";
  const match = /^(\d{4})(h1|h2)$/.exec(value);
  if (!match) return value;
  return `${match[1]} ${match[2] === "h1" ? "상반기" : "하반기"}`;
}

export function messagePreview(value: string | null | undefined, max = 48): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export type NewsletterItem = {
  id: string;
  name: string | null;
  email: string;
  locale: string;
  confirmed: boolean;
  created_at: string;
};

export type NewsletterList = {
  items: NewsletterItem[];
  summary: { total: number; thisMonth: number };
};
