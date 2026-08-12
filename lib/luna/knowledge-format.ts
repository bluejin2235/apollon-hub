export function formatKnowledgeDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return "어제";
  }
  return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

export function formatScanTime(hour: number, minute: number): string {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function formatDurationSec(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m <= 0) return `${s}초`;
  return `${m}분 ${s}초`;
}

export function scopeLabel(scope: string | null | undefined): {
  label: string;
  badge: "org" | "me";
} | null {
  if (scope === "org") return { label: "조직", badge: "org" };
  if (scope === "personal") return { label: "개인", badge: "me" };
  return null;
}

export function sourceLabel(
  source: string | null | undefined,
  origin?: string | null
): string {
  if (source === "chat") return "대화에서";
  if (source === "direct") return "알려주기";
  if (source === "selfstudy") return "자습에서";
  if (source === "question") return "루나의 질문";
  if (origin === "direct") return "알려주기";
  if (origin === "eval_feedback") return "평가 피드백";
  return "—";
}

export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000)));
}

export function clipText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export const K = {
  bg: "#f5f6f8",
  panel: "#ffffff",
  line: "#e7e8ec",
  line2: "#eef0f3",
  ink: "#1c1d21",
  sub: "#6b6f76",
  faint: "#9aa0a8",
  chip: "#f1f2f5",
  luna: "#534AB7",
  lunaSoft: "#EEEDFE",
  lunaInk: "#3C3489",
  talk: "#0F6E56",
  talkSoft: "#E1F5EE",
  cand: "#D85A30",
  candSoft: "#FAECE7",
  candInk: "#993C1D",
  danger: "#A32D2D",
  dangerSoft: "#FCEBEB"
} as const;
