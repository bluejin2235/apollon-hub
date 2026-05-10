export function PortalAuthChecking({ light = false }: { light?: boolean }) {
  void light;
  return (
    <main className="flex min-h-screen items-center justify-center bg-white text-gray-600">
      인증 상태를 확인하는 중...
    </main>
  );
}
