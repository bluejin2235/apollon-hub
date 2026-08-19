"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Person = { id: string; name: string; note?: string | null };
type Payload = {
  superadmins?: Person[];
  members?: Person[];
  addable?: Person[];
  error?: string;
};

async function token(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export function LunaBetaAccessPanel() {
  const [superadmins, setSuperadmins] = useState<Person[]>([]);
  const [members, setMembers] = useState<Person[]>([]);
  const [addable, setAddable] = useState<Person[]>([]);
  const [pick, setPick] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const t = await token();
    if (!t) return;
    const res = await fetch("/api/luna/beta-access", {
      headers: { Authorization: `Bearer ${t}` }
    });
    const json = (await res.json()) as Payload;
    if (!res.ok) {
      setError(json.error ?? "불러오지 못했습니다.");
      return;
    }
    setError("");
    setSuperadmins(json.superadmins ?? []);
    setMembers(json.members ?? []);
    setAddable(json.addable ?? []);
    setPick("");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (!pick) return;
    setBusy(true);
    try {
      const t = await token();
      if (!t) return;
      const res = await fetch("/api/luna/beta-access", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${t}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ profile_id: pick })
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "추가하지 못했습니다.");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const t = await token();
      if (!t) return;
      const res = await fetch("/api/luna/beta-access", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${t}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ profile_id: id })
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "제거하지 못했습니다.");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  const names = [
    ...superadmins.map((p) => `${p.name}(슈퍼관리자)`),
    ...members.map((p) => p.name)
  ];

  return (
    <section className="mt-4 rounded-[12px] border border-[#e7e8ec] bg-white px-4 py-3.5">
      <h2 className="text-[13px] font-bold text-[#1c1d21]">루나를 쓸 수 있는 사람</h2>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#6b6f76]">
        {names.length > 0 ? names.join(" · ") : "목록이 없습니다."}
      </p>
      {error ? <p className="mt-2 text-[12px] text-rose-600">{error}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12px] text-slate-800"
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          disabled={busy || addable.length === 0}
        >
          <option value="">멤버 선택</option>
          {addable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || !pick}
          onClick={() => void add()}
          className="rounded-lg bg-[#534AB7] px-2.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          ＋ 추가
        </button>
      </div>
      {members.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {members.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-2 text-[12px] text-slate-700"
            >
              <span>{p.name}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove(p.id)}
                className="rounded-md border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 hover:border-rose-200 hover:text-rose-600 disabled:opacity-40"
              >
                제거
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
