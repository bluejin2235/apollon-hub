"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { brainFetch } from "@/components/luna/brain/shared";
import { K } from "@/lib/luna/knowledge-format";

type MappingRow = {
  department: string;
  lens_prompt_key: string | null;
  updated_at?: string;
};

type Payload = {
  mappings?: MappingRow[];
  error?: string;
};

export function useDepartmentLens() {
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [error, setError] = useState("");
  const [busyDept, setBusyDept] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const json = await brainFetch<Payload>("/api/luna/department-lens");
      setRows(json.mappings ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "매핑을 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const assignedByLens = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.lens_prompt_key) continue;
      const list = map.get(row.lens_prompt_key) ?? [];
      list.push(row.department);
      map.set(row.lens_prompt_key, list);
    }
    return map;
  }, [rows]);

  const unassigned = useMemo(
    () => rows.filter((r) => !r.lens_prompt_key).map((r) => r.department),
    [rows]
  );

  async function save(department: string, lens_prompt_key: string | null) {
    setBusyDept(department);
    setError("");
    try {
      await brainFetch("/api/luna/department-lens", {
        method: "PATCH",
        body: JSON.stringify({ department, lens_prompt_key })
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setBusyDept("");
    }
  }

  return { rows, assignedByLens, unassigned, error, busyDept, save };
}

export function LensDepartmentBadges({
  lensKey,
  assigned,
  unassigned,
  busyDept,
  onAssign,
  onRemove
}: {
  lensKey: string;
  assigned: string[];
  unassigned: string[];
  busyDept: string;
  onAssign: (department: string, lensKey: string) => void;
  onRemove: (department: string) => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="mt-1.5 flex flex-wrap gap-1" style={{ marginLeft: 53 }}>
      {assigned.map((dept) => (
        <button
          key={dept}
          type="button"
          disabled={busyDept === dept}
          onClick={() => onRemove(dept)}
          className="rounded-[9px] px-[7px] py-0.5 text-[10px] disabled:opacity-50"
          style={{ background: K.chip, color: K.sub }}
          title="클릭하면 이 관점에서 제거"
        >
          {dept}
        </button>
      ))}
      {unassigned.length > 0 ? (
        adding ? (
          <select
            autoFocus
            className="rounded-[9px] border px-1.5 py-0.5 text-[10px] outline-none"
            style={{ borderColor: K.line, background: K.panel, color: K.sub }}
            defaultValue=""
            onBlur={() => setAdding(false)}
            onChange={(e) => {
              const dept = e.target.value;
              if (dept) onAssign(dept, lensKey);
              setAdding(false);
            }}
          >
            <option value="">부서 선택</option>
            {unassigned.map((dept) => (
              <option key={dept} value={dept}>
                {dept}
              </option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-[9px] px-[7px] py-0.5 text-[10px]"
            style={{ background: K.chip, color: K.sub }}
          >
            + 부서 추가
          </button>
        )
      ) : null}
    </div>
  );
}
