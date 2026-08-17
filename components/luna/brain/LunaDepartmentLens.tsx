"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Btn,
  ErrorLine,
  FieldSelect,
  ListCard
} from "@/components/luna/knowledge/ui";
import { brainFetch, SectionTitle } from "@/components/luna/brain/shared";
import { K } from "@/lib/luna/knowledge-format";

type MappingRow = {
  department: string;
  lens_prompt_key: string | null;
  updated_at?: string;
};

type LensOption = { prompt_key: string | null; title: string };

type Payload = {
  mappings?: MappingRow[];
  lenses?: Array<{ prompt_key: string | null; title: string }>;
  error?: string;
};

export function LunaDepartmentLens() {
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [lenses, setLenses] = useState<LensOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyDept, setBusyDept] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const json = await brainFetch<Payload>("/api/luna/department-lens");
      setRows(json.mappings ?? []);
      setLenses(
        (json.lenses ?? []).map((l) => ({
          prompt_key: l.prompt_key,
          title: l.title
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "매핑을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(department: string, lens_prompt_key: string | null) {
    setBusyDept(department);
    setNotice("");
    setError("");
    try {
      await brainFetch("/api/luna/department-lens", {
        method: "PATCH",
        body: JSON.stringify({ department, lens_prompt_key })
      });
      setNotice("부서 관점 매핑을 저장했습니다.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setBusyDept("");
    }
  }

  return (
    <div className="mb-5">
      <SectionTitle>부서 → 관점 매핑</SectionTitle>
      <p className="mb-2 text-[12px]" style={{ color: K.faint }}>
        채팅에서 관점을 수동 지정하지 않으면 이 표로 L2를 붙입니다. 전사·빈 값은
        주입하지 않습니다.
      </p>
      {loading ? (
        <p className="text-[12px]" style={{ color: K.faint }}>
          불러오는 중…
        </p>
      ) : null}
      {error ? <ErrorLine message={error} /> : null}
      {notice ? (
        <p className="mb-2 text-[12px]" style={{ color: K.sub }}>
          {notice}
        </p>
      ) : null}
      {!loading && rows.length > 0 ? (
        <ListCard>
          {rows.map((row) => (
            <div
              key={row.department}
              className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 last:border-b-0"
              style={{ borderColor: K.line2 }}
            >
              <span className="w-[140px] shrink-0 text-[13px]">{row.department}</span>
              <FieldSelect
                className="min-w-[200px] flex-1"
                value={row.lens_prompt_key ?? ""}
                disabled={busyDept === row.department}
                onChange={(e) => {
                  const next = e.target.value.trim();
                  void save(row.department, next || null);
                }}
              >
                <option value="">(없음 — 주입 안 함)</option>
                {lenses.map((lens) =>
                  lens.prompt_key ? (
                    <option key={lens.prompt_key} value={lens.prompt_key}>
                      {lens.title} ({lens.prompt_key})
                    </option>
                  ) : null
                )}
              </FieldSelect>
              {busyDept === row.department ? (
                <span className="text-[11px]" style={{ color: K.faint }}>
                  저장 중
                </span>
              ) : (
                <Btn
                  className="!px-2 !py-1 text-[11px]"
                  onClick={() => void save(row.department, row.lens_prompt_key)}
                >
                  다시 저장
                </Btn>
              )}
            </div>
          ))}
        </ListCard>
      ) : null}
    </div>
  );
}
