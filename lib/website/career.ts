export const JOB_ROLES = [
  "space-planning",
  "space-design",
  "content-planning",
  "content-design",
  "hardware-design"
] as const;

export type JobRole = (typeof JOB_ROLES)[number];

export const JOB_ROLE_LABEL: Record<JobRole, string> = {
  "space-planning": "공간기획",
  "space-design": "공간디자인",
  "content-planning": "콘텐츠기획",
  "content-design": "콘텐츠디자인",
  "hardware-design": "하드웨어디자인"
};

export const TALENT_INTEREST_LABEL: Record<string, string> = {
  ...JOB_ROLE_LABEL,
  all: "전 직군"
};

export const JOB_EMPLOYMENTS = ["정규직", "계약직", "인턴"] as const;
export const JOB_EXPERIENCES = ["신입", "경력", "무관"] as const;

export type JobStatus = "draft" | "open" | "closed";

export type JobPosting = {
  id: string;
  title: string;
  role: JobRole;
  employment: string;
  experience: string;
  apply_url: string | null;
  status: JobStatus;
  posted_at: string | null;
  closes_at: string | null;
  sort: number;
  created_at: string;
  updated_at: string;
};

export type TalentPoolItem = {
  id: string;
  name: string;
  email: string;
  interests: string[];
  notify_until: string;
  locale: string;
  created_at: string;
  is_active: boolean;
  expiring_soon: boolean;
  wants_all: boolean;
};

export type TalentPoolList = {
  items: TalentPoolItem[];
  counts: { role: string; n: number }[];
  summary: { active: number; expired: number; expiringSoon: number };
};

export function formatDotDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = value.slice(0, 10);
  const [y, m, day] = d.split("-");
  if (!y || !m || !day) return d;
  return `${y}.${m}.${day}`;
}

export function interestLabels(interests: string[]): string {
  if (!Array.isArray(interests) || interests.length === 0) return "—";
  return interests.map((id) => TALENT_INTEREST_LABEL[id] ?? id).join(", ");
}

export function emptyJobDraft(): Omit<JobPosting, "id" | "created_at" | "updated_at" | "sort"> {
  return {
    title: "",
    role: "space-design",
    employment: "정규직",
    experience: "무관",
    apply_url: "",
    status: "draft",
    posted_at: "",
    closes_at: ""
  };
}
