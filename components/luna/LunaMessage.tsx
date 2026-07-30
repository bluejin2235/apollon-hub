"use client";

type LunaMessageProps = {
  role: "user" | "assistant";
  content: string;
  engine?: string | null;
};

export function LunaMessage({ role, content, engine }: LunaMessageProps) {
  if (role === "user") {
    return (
      <div className="flex justify-end px-4 py-1.5">
        <div className="max-w-[85%] rounded-[12px_12px_2px_12px] bg-[#EEEDFE] px-3.5 py-2.5 text-sm leading-relaxed text-slate-900 whitespace-pre-wrap break-words">
          {content}
          {engine ? (
            <div className="mt-1.5 text-[10px] text-gray-500 opacity-70">{engine}</div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5 px-4 py-1.5">
      <div
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#534AB7] text-xs font-semibold text-white"
        aria-hidden
      >
        L
      </div>
      <div className="max-w-[85%] min-w-0">
        <div className="rounded-[12px_12px_12px_2px] bg-slate-100 px-3.5 py-2.5 text-sm leading-relaxed text-slate-900 whitespace-pre-wrap break-words">
          {content || (
            <span className="inline-block h-4 w-4 animate-pulse rounded-full bg-slate-300" />
          )}
        </div>
        {engine ? (
          <div className="mt-1 text-[10px] text-gray-500 opacity-70">{engine}</div>
        ) : null}
      </div>
    </div>
  );
}
