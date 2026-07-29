import { SERVICE_URL } from "@/lib/services/permissions";

/**
 * 서비스별 중간관리자 권한 안내 문구 (UI 공용).
 *
 * 권한 로직이 바뀌면 `lib/services/permissions.ts`의 대응 함수와
 * 이 설명 문구를 함께 수정한다.
 */
export const MIDDLE_ADMIN_DESCRIPTIONS: Record<string, string> = {
  [SERVICE_URL.LICENSE_MANAGER]:
    "라이선스 생성은 모든 팀원이 가능합니다. 수정·삭제는 슈퍼관리자, 라이선스매니저 중간관리자, 그리고 각 라이선스에 지정된 담당자만 가능합니다.",
  [SERVICE_URL.ASHULENG]:
    "중간관리자는 다른 팀원이 등록한 맛집 게시물도 수정·삭제할 수 있습니다.",
  [SERVICE_URL.ARTE]:
    "현재 아르테는 중간관리자 권한이 별도로 연결되어 있지 않습니다. 지정해도 기능적 효과가 없습니다.",
  [SERVICE_URL.SUPPLIES]:
    "중간관리자는 다른 팀원이 등록한 비품도 수정·삭제할 수 있습니다 (담당자 지정 여부 무관).",
  [SERVICE_URL.RESEARCH]:
    "중간관리자는 프롬프트 관리, Publishing(예약·즉시발송), 트렌드 구독함 페이지에 접근하고 수정할 수 있습니다."
};
