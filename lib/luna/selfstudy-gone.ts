import { NextResponse } from "next/server";

/** Phase 0: 자습 비활성화. Phase 5에서 재작성 시 제거. */
export function lunaSelfstudyGone() {
  return NextResponse.json(
    {
      error: "Gone",
      message: "LUNA selfstudy is disabled (Phase 0 redevelopment)"
    },
    { status: 410 }
  );
}
