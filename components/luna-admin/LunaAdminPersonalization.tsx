"use client";

import { useCallback, useEffect, useState } from "react";
import type { LunaUserMemory } from "@/lib/luna/user-memory-shared";

type PersonRow = {
  user_id: string;
  name: string | null;
  department: string | null;
  memo_chars: number;
  memo_preview: string;
  has_memo: boolean;
  conversations: number;
  thumbs_down: number;
  last_at: string | null;
};

function formatDay(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const today = new Date();
  if (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  ) {
    return "오늘";
  }
  return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, "0")}`;
}

/** LUNA 관리자 › 대화 › 개인화 */
export function LunaAdminPersonalization() {
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    name: string | null;
    department: string | null;
    memory: LunaUserMemory | null;
  } | null>(null);
  const [changes, setChanges] = useState<
    Array<{
      id: string;
      prompt_title: string;
      pattern: string;
      evidence_count: number;
      status: string;
      created_at: string;
    }>
  >([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, cRes] = await Promise.all([
        fetch("/api/luna/admin/personalization", { cache: "no-store" }),
        fetch("/api/luna/admin/perspective-changes", { cache: "no-store" })
      ]);
      if (pRes.ok) {
        const json = (await pRes.json()) as { people?: PersonRow[] };
        setPeople(json.people ?? []);
      }
      if (cRes.ok) {
        const json = (await cRes.json()) as { items?: typeof changes };
        setChanges(json.items ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function openPerson(userId: string) {
    setSelected(userId);
    const res = await fetch(
      `/api/luna/admin/personalization?user_id=${encodeURIComponent(userId)}`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      setDetail(null);
      return;
    }
    const json = (await res.json()) as {
      profile?: { name: string | null; department: string | null };
      memory?: LunaUserMemory | null;
    };
    setDetail({
      name: json.profile?.name ?? null,
      department: json.profile?.department ?? null,
      memory: json.memory ?? null
    });
  }

  async function revertChange(id: string) {
    await fetch("/api/luna/admin/perspective-changes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "revert" })
    });
    void load();
  }

  return (
    <div className="space-y-8 p-6">
      <div>
        <h2 className="text-[13.5px] font-extrabold text-slate-900">사람별</h2>
        <p className="mt-1 text-[12px] text-[#6b7280]">
          이름을 누르면 루나가 그 사람에 대해 쓴 글 전체를 봅니다.
        </p>
      </div>

      {loading ? (
        <p className="text-[12px] text-[#9ca3af]">불러오는 중…</p>
      ) : (
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              <th className="border-b border-[#e5e7eb] bg-[#FAFAFB] px-2.5 py-2 text-left text-[10px] font-bold text-[#9ca3af]">
                이름
              </th>
              <th className="border-b border-[#e5e7eb] bg-[#FAFAFB] px-2.5 py-2 text-left text-[10px] font-bold text-[#9ca3af]">
                팀
              </th>
              <th className="border-b border-[#e5e7eb] bg-[#FAFAFB] px-2.5 py-2 text-left text-[10px] font-bold text-[#9ca3af]">
                루나가 아는 것
              </th>
              <th className="border-b border-[#e5e7eb] bg-[#FAFAFB] px-2.5 py-2 text-right text-[10px] font-bold text-[#9ca3af]">
                대화
              </th>
              <th className="border-b border-[#e5e7eb] bg-[#FAFAFB] px-2.5 py-2 text-right text-[10px] font-bold text-[#9ca3af]">
                👎
              </th>
              <th className="border-b border-[#e5e7eb] bg-[#FAFAFB] px-2.5 py-2 text-left text-[10px] font-bold text-[#9ca3af]">
                마지막
              </th>
            </tr>
          </thead>
          <tbody>
            {people.map((row) => (
              <tr
                key={row.user_id}
                className="cursor-pointer hover:bg-[#FAFBFC]"
                onClick={() => void openPerson(row.user_id)}
              >
                <td className="border-b border-[#f1f2f4] px-2.5 py-2.5 font-bold">
                  {row.name ?? "—"}
                </td>
                <td className="border-b border-[#f1f2f4] px-2.5 py-2.5 text-[#9ca3af]">
                  {row.department ?? "—"}
                </td>
                <td className="border-b border-[#f1f2f4] px-2.5 py-2.5">
                  {row.has_memo ? (
                    <>
                      {row.memo_chars}자
                      <div className="mt-0.5 text-[11px] text-[#9ca3af]">
                        {row.memo_preview}
                      </div>
                    </>
                  ) : (
                    <span className="text-[#9ca3af]">
                      아직 없음
                      <div className="mt-0.5 text-[11px]">
                        대화 {row.conversations}건 · 쌓이는 중
                      </div>
                    </span>
                  )}
                </td>
                <td className="border-b border-[#f1f2f4] px-2.5 py-2.5 text-right font-mono text-[11px]">
                  {row.conversations}
                </td>
                <td className="border-b border-[#f1f2f4] px-2.5 py-2.5 text-right font-mono text-[11px]">
                  {row.thumbs_down}
                </td>
                <td className="border-b border-[#f1f2f4] px-2.5 py-2.5 text-[#9ca3af]">
                  {formatDay(row.last_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected && detail ? (
        <div className="overflow-hidden rounded-[11px] border border-[#DDD9FB]">
          <div className="flex items-center gap-2 border-b border-[#DDD9FB] bg-[#F0EFFE] px-4 py-3">
            <span className="flex-1 text-[12.5px] font-extrabold">
              {detail.name ?? "—"}
              {detail.department ? ` · ${detail.department}` : ""}
            </span>
            <button
              type="button"
              className="text-[15px] text-[#9ca3af]"
              onClick={() => {
                setSelected(null);
                setDetail(null);
              }}
            >
              ✕
            </button>
          </div>
          <div className="bg-white p-4">
            {detail.memory?.memo?.trim() ? (
              <div className="whitespace-pre-line rounded-[10px] border border-[#e5e7eb] bg-[#FAFAFB] px-4 py-4 text-[12.5px] leading-[2]">
                {detail.memory.memo}
              </div>
            ) : (
              <p className="text-[12px] text-[#9ca3af]">아직 쌓인 글이 없습니다.</p>
            )}
          </div>
        </div>
      ) : null}

      {changes.length > 0 ? (
        <div>
          <h2 className="mb-2 text-[13.5px] font-extrabold text-slate-900">
            팀 관점으로 올라간 것
          </h2>
          <ul className="space-y-2 text-[12px]">
            {changes.map((c) => (
              <li
                key={c.id}
                className="flex items-start gap-3 rounded-lg border border-[#e5e7eb] px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{c.pattern}</div>
                  <div className="text-[#9ca3af]">
                    {c.prompt_title} · {c.evidence_count}명 · {c.status}
                  </div>
                </div>
                {c.status === "applied" ? (
                  <button
                    type="button"
                    className="shrink-0 text-[#534AB7] hover:underline"
                    onClick={() => void revertChange(c.id)}
                  >
                    되돌리기
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
