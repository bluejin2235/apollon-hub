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

/** 헤더 우측: 이름 / 부서 / 권한 */
export function formatPortalHeaderUserInfo(
  profile: Pick<PortalProfileRow, "name" | "department" | "role">
): string {
  const roleLabel =
    profile.role?.trim() ||
    "멤버";
  return `${profile.name || "-"} / ${profile.department || "-"} / ${roleLabel}`;
}
