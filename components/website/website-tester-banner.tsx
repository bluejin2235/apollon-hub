// TODO(홈페이지 오픈 후 삭제) 개발 기간 한정 테스트 계정 권한

export function WebsiteTesterBanner() {
  return (
    <div
      className="fixed top-14 left-0 right-0 z-40 border-b border-slate-200 bg-slate-50/95 px-4 py-1.5 text-center text-[11px] text-slate-600 backdrop-blur-sm"
      role="status"
    >
      홈페이지 개발 검토용 계정입니다. 홈페이지 어드민만 사용할 수 있습니다
    </div>
  );
}
