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
  if (!value) return "—";
  return BUDGET_LABEL[value] ?? value;
}

export function timelineLabel(value: string | null | undefined): string {
  if (!value) return "—";
  if (value === "undecided") return "미정";
  if (value === "later") return "그 이후";
  const match = /^(\d{4})(h1|h2)$/.exec(value);
  if (!match) return value;
  return `${match[1]} ${match[2] === "h1" ? "상반기" : "하반기"}`;
}

export function messagePreview(value: string | null | undefined, max = 48): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "—";
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
