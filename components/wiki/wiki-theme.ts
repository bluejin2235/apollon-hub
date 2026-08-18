export const W = {
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
  lock: "#8A6D2F",
  lockBg: "#FAF3E2",
  add: "#0F6E56",
  addBg: "#EAF7F2",
  del: "#A32D2D",
  delBg: "#FCEFEF"
} as const;

export function formatWikiWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCMonth() + 1}/${kst.getUTCDate()}`;
}

export function formatWikiStamp(
  iso: string | null | undefined,
  name: string | null | undefined
): string {
  if (!iso) return "아직 고친 기록이 없습니다";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "아직 고친 기록이 없습니다";
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const who = name?.trim() || "누군가";
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${who}이 ${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일 ${hh}:${mm}에 마지막으로 고침`;
}
