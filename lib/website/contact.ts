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

/** 메모에서 부른 사람 (@이름). 같은 자리에서는 가장 긴 이름을 고른다. */
export function mentionedMemberNames(text: string, names: string[]): string[] {
  const sorted = [...new Set(names.map((name) => name.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length
  );
  if (sorted.length === 0 || !text) return [];
  const found = new Set<string>();
  let index = text.indexOf("@");
  while (index !== -1) {
    const rest = text.slice(index + 1);
    const hit = sorted.find((name) => rest.startsWith(name));
    if (hit) found.add(hit);
    index = text.indexOf("@", index + 1);
  }
  return [...found];
}

/** @ 로 고를 수 있는 허브 사람 */
export type MentionMember = { id: string; name: string; team: string | null };

/** 메모 저장 결과 (허브 알림·메일을 보낸 사람) */
export type InquiryMemoResult = {
  item: InquiryItem;
  notified: string[];
  mailFailed: string[];
};

export type InquiryFile = { name: string; size: number; url: string | null };
export type InquiryFiles = { items: InquiryFile[]; missing: string[] };

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
