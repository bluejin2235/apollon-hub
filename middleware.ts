import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * 업로드 multipart 는 미들웨어 본문 버퍼(기본 10MB)를 피한다.
     * 인증은 라우트에서 Bearer 로 처리한다.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/website/upload|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"
  ]
};
