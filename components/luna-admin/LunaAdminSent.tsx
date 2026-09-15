"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";
import type { SentRow } from "@/lib/luna-admin/types";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const same =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (same) return "오늘";
  return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

export function LunaAdminSent() {
  const [rows, setRows] = useState<SentRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setError("");
      const json = await adminFetch<{ rows: SentRow[] }>("/api/luna-admin/sent");
      setRows(json.rows ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="empty">불러오는 중…</p>;
  if (error) return <p className="empty">{error}</p>;
  if (rows.length === 0) return <p className="empty">자습으로 보낸 기록이 없습니다.</p>;

  return (
    <table>
      <thead>
        <tr>
          <th>실패</th>
          <th>보낸 날</th>
          <th>자습 주제</th>
          <th>결과</th>
          <th>해결</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>{row.failure_label}</td>
            <td>{formatWhen(row.sent_at)}</td>
            <td>{row.topic}</td>
            <td className="mono">{row.result}</td>
            <td>
              {row.resolved ? (
                <span className="tag g">해결</span>
              ) : (
                <span className="tag gray">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
