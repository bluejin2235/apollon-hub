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
