/** Minimal `profiles` row used across portal shells and hub. */
export type PortalProfileRow = {
  id: string;
  email: string;
  name: string;
  department: string;
  role?: string;
};

export function formatPortalProfileSummary(profile: Pick<PortalProfileRow, "name" | "department">): string {
  return `${profile.name || "-"} / ${profile.department || "-"}`;
}
