"use client";

export function SupplyToast({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null;
  return (
    <div className="fixed bottom-6 left-1/2 z-[60] max-w-sm -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg">
      <div className="flex items-center gap-3">
        <span>{message}</span>
        <button type="button" onClick={onClose} className="text-slate-300 hover:text-white" aria-label="닫기">
          ×
        </button>
      </div>
    </div>
  );
}
