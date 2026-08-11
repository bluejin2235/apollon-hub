import { lunaSelfstudyGone } from "@/lib/luna/selfstudy-gone";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Phase 0: disabled. Original implementation: route.phase5.bak */
export async function POST() {
  return lunaSelfstudyGone();
}
