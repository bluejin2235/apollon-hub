export type PortalService = {
  title: string;
  description: string;
  icon: string;
  href?: string;
  comingSoon?: boolean;
};

export const portalServices: PortalService[] = [
  {
    title: "Apollon License Manager",
    description: "라이선스 발급, 관리, 상태 조회를 위한 통합 관리 서비스",
    icon: "🔑",
    href: "/licenses"
  },
  {
    title: "아슐랭",
    description: "팀 추천 맛집을 공유하고 리뷰를 남기는 사내 커뮤니티",
    icon: "🍱",
    href: "/restaurants"
  },
  {
    title: "새 서비스",
    description: "추후 신규 서비스를 이 허브에 손쉽게 추가할 수 있습니다.",
    icon: "✨",
    comingSoon: true
  }
];
