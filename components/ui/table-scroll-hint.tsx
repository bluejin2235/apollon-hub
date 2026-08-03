"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
};

/** Wraps a horizontally scrollable table; shows a hint only when content overflows. */
export function TableScrollHint({ children, className = "tablewrap" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const check = () => {
      setOverflow(el.scrollWidth > el.clientWidth + 1);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener("resize", check);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", check);
    };
  }, []);

  return (
    <div className="min-w-0">
      <div ref={ref} className={className}>
        {children}
      </div>
      {overflow ? (
        <p className="mt-1.5 text-[11px] text-gray-500 md:hidden">옆으로 밀어서 더 보기</p>
      ) : null}
    </div>
  );
}
