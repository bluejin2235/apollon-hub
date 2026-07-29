"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isSupplyUuid } from "@/lib/supplies/qr";
import { supabase } from "@/lib/supabase/client";

type PageState = "loading" | "blocked";

export default function ShortSupplyPage() {
  const params = useParams();
  const router = useRouter();
  const id = decodeURIComponent(String(params.id ?? "")).trim();
  const [pageState, setPageState] = useState<PageState>("loading");

  useEffect(() => {
    if (!id) {
      setPageState("blocked");
      return;
    }

    let cancelled = false;

    const run = async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (cancelled) return;

      if (!session) {
        router.replace(`/?redirect=${encodeURIComponent(`/s/${id}`)}`);
        return;
      }

      const query = supabase.from("supplies").select("id, code, status, name");
      const { data: supply, error } = isSupplyUuid(id)
        ? await query.eq("id", id.toLowerCase()).maybeSingle()
        : await query.eq("code", id).maybeSingle();

      if (cancelled) return;

      if (error || !supply) {
        setPageState("blocked");
        return;
      }

      if (supply.status === "available" || supply.status === "partially_borrowed") {
        router.replace(`/supplies/${supply.id}/loan`);
        return;
      }

      if (supply.status === "borrowed" || supply.status === "unavailable") {
        setPageState("blocked");
        return;
      }

      setPageState("blocked");
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [id, router]);

  if (pageState === "loading") {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 px-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <div
            className="h-10 w-10 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600"
            role="status"
            aria-label="확인 중"
          />
          <p className="text-sm font-medium text-slate-600">확인 중...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4">
      <section className="apollon-card w-full max-w-md p-8 text-center shadow-glow">
        <h1 className="text-xl font-bold text-slate-900">대출할 수 없습니다</h1>
        <p className="mt-3 text-sm text-slate-600">
          물품을 찾을 수 없거나 현재 대출할 수 없는 상태입니다.
        </p>
        <button
          type="button"
          onClick={() => router.push("/supplies")}
          className="mt-8 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500"
        >
          물품 목록으로
        </button>
      </section>
    </main>
  );
}
