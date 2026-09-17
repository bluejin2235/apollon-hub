export type DevnoteStatus = "live" | "wip" | "stuck" | "doc";

export type DevnoteServiceNav = {
  slug: string;
  name: string;
  status: DevnoteStatus;
};

export type DevnoteNavData = {
  services: DevnoteServiceNav[];
  decisionCount: number;
  ideaCount: number;
  openBlockerCount: number;
};

export function isDevnoteStatus(value: string): value is DevnoteStatus {
  return (
    value === "live" ||
    value === "wip" ||
    value === "stuck" ||
    value === "doc"
  );
}

export type DevnoteOverviewTab = "body" | "env" | "structure" | "principles";

export type DevnoteOverviewRow = {
  body: string;
  env: string;
  structure: string;
  principles: string;
  updated_at: string | null;
};

export const EMPTY_DEVNOTE_OVERVIEW: DevnoteOverviewRow = {
  body: "",
  env: "",
  structure: "",
  principles: "",
  updated_at: null
};

export const DEVNOTE_OVERVIEW_TABS: Array<{
  key: DevnoteOverviewTab;
  label: string;
}> = [
  { key: "body", label: "개요" },
  { key: "env", label: "개발 환경" },
  { key: "structure", label: "구조" },
  { key: "principles", label: "원칙" }
];

export function parseDevnoteOverviewTab(
  raw: string | null | undefined
): DevnoteOverviewTab {
  if (raw === "env" || raw === "structure" || raw === "principles") return raw;
  return "body";
}

export type DevnoteServiceTab = "overview" | "decisions" | "data" | "todos";

export type DevnoteServiceRow = {
  id: string;
  slug: string;
  name: string;
  path: string | null;
  repo: string | null;
  status: DevnoteStatus;
  overview: string;
  data_notes: string;
  updated_at: string | null;
};

export type DevnoteDecisionRow = {
  id: string;
  service_id: string | null;
  decided_on: string;
  what: string;
  why: string;
  is_key: boolean;
};

export type DevnoteTodoRow = {
  id: string;
  service_id: string | null;
  title: string;
  body: string | null;
  done: boolean;
  sort_order: number;
};

export type DevnoteIdeaStage = "next" | "someday" | "seed";

export type DevnoteIdeaRow = {
  id: string;
  service_id: string | null;
  service_name: string;
  service_slug: string | null;
  title: string;
  body: string;
  stage: DevnoteIdeaStage;
  sort_order: number;
};

export type DevnoteDecisionListRow = DevnoteDecisionRow & {
  service_name: string;
  service_slug: string | null;
};

export const STATUS_LABEL: Record<DevnoteStatus, string> = {
  live: "운영 중",
  wip: "개발 중",
  stuck: "막힘",
  doc: "문서만"
};

export const DEVNOTE_IDEA_STAGES: Array<{
  key: DevnoteIdeaStage;
  label: string;
}> = [
  { key: "next", label: "다음에" },
  { key: "someday", label: "언젠가" },
  { key: "seed", label: "씨앗" }
];

export function isDevnoteIdeaStage(value: string): value is DevnoteIdeaStage {
  return value === "next" || value === "someday" || value === "seed";
}

export function parseDevnoteServiceTab(
  raw: string | null | undefined
): DevnoteServiceTab {
  if (raw === "decisions" || raw === "data" || raw === "todos") return raw;
  return "overview";
}
