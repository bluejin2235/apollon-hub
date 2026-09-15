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
