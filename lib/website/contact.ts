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
};

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
