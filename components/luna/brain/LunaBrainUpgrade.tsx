"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Btn,
  ErrorLine,
  KnowledgeShell,
  ListCard,
  LoadingLine
} from "@/components/luna/knowledge/ui";
import {
  BrainCard,
  BtnNote,
  BtnRow,
  brainFetch,
  CardTop,
  formatDateTime,
  formatMonthDay,
  InfoBar,
  KvLine,
  RunBar,
  SectionTitle
} from "@/components/luna/brain/shared";
import { clipText, K } from "@/lib/luna/knowledge-format";

type HistoryItem = {
  id: string;
  target_id: string;
  prompt_number: string | null;
  prompt_title: string | null;
  version: number;
  prev_version: number | null;
  changed_by_luna: boolean;
  editor_name: string | null;
  change_summary: string | null;
  prediction: string | null;
  verify_result: string | null;
  verify_note: string | null;
  score_from: number | null;
  score_to: number | null;
  score_total: number | null;
  is_revert: boolean;
  reverted_later: boolean;
  created_at: string;
};

type Pending = {
  prompt_id: string;
  prompt_number: string | null;
  title: string;
  version: number;
  previous_version: number;
  reason: string;
  prediction: string;
  suggested_at: string;
};

type LastRun = {
  skipped: boolean;
  message: string;
  title?: string;
  version?: number;
  score_dropped?: boolean;
} | null;

type UpgradeResponse = {
  pending: Pending | null;
  last_run: LastRun;
  history: HistoryItem[];
};

function promptLabel(item: HistoryItem): string {
  const head = [item.prompt_number, item.prompt_title].filter(Boolean).join(" ");
  const base = head || "삭제된 프롬프트";
  if (item.changed_by_luna || !item.change_summary) {
    return item.prev_version
      ? `${base} · v${item.prev_version} → v${item.version}`
      : `${base} · v${item.version}`;
  }
  return `${base} · ${clipText(item.change_summary, 40)}`;
}

function ScoreBadge({ item }: { item: HistoryItem }) {
  if (item.score_to == null) return null;
  const score =
    item.score_from != null
      ? `시험 ${item.score_from} → ${item.score_to}`
      : `시험 ${item.score_to}${item.score_total ? `/${item.score_total}` : ""}`;
  let suffix = "";
  if (item.reverted_later) suffix = " · 되돌림";
  else if (item.verify_result === "confirmed") suffix = " · 예측 확인";
  else if (item.verify_result === "refuted") suffix = " · 예측 빗나감";
  const bad = item.reverted_later || item.verify_result === "refuted";
  return (
    <Badge kind={bad ? "red" : "ok"}>
      {score}
      {suffix}
    </Badge>
  );
}

export function LunaBrainUpgrade() {
  const router = useRouter();
  const [data, setData] = useState<UpgradeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await brainFetch<UpgradeResponse>("/api/luna/brain/upgrade"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function applyRevert(pending: Pending) {
    setBusy(true);
    setNotice("");
    try {
      await brainFetch("/api/luna/prompts/revert", {
        method: "POST",
        body: JSON.stringify({
          id: pending.prompt_id,
          version: pending.previous_version
        })
      });
      setNotice(`v${pending.previous_version} 내용으로 되돌렸습니다.`);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "되돌리지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    setBusy(true);
    setNotice("");
    try {
      await brainFetch("/api/luna/brain/upgrade", { method: "DELETE" });
      setNotice("제안을 반려했습니다. 현재 버전을 그대로 둡니다.");
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "반려하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    setBusy(true);
    setNotice("");
    try {
      const res = await brainFetch<{ skipped: boolean; message: string }>(
        "/api/luna/self-upgrade",
        { method: "POST" }
      );
      setNotice(res.message || "점검을 마쳤습니다.");
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "점검하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const pending = data?.pending ?? null;
  const history = data?.history ?? [];

  return (
    <KnowledgeShell>
      <InfoBar>
        루나는 확정된 지식과 3회 이상 반복된 정정만을 근거로 L2~L4를 스스로 고칩니다.
        L1·L5는 사람만 수정합니다.
      </InfoBar>

      {notice ? (
        <p className="mb-2.5 text-[12px]" style={{ color: K.luna }}>
          {notice}
        </p>
      ) : null}
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <LoadingLine /> : null}

      {!loading && !error ? (
        <>
          <SectionTitle>개선 대기</SectionTitle>
          {pending ? (
            <BrainCard highlight>
              <CardTop>
                <Badge kind="wait">루나의 되돌림 제안</Badge>
                <span className="text-[13.5px] font-bold">
                  {[pending.prompt_number, pending.title].filter(Boolean).join(" ")} ·
                  v{pending.version} → v{pending.previous_version}
                </span>
                <span
                  className="ml-auto text-[11.5px]"
                  style={{ color: K.faint }}
                >
                  {formatDateTime(pending.suggested_at)}
                </span>
              </CardTop>
              <div className="mb-2.5">
                <KvLine label="근거">{pending.reason || "—"}</KvLine>
                <KvLine label="예측">{pending.prediction || "—"}</KvLine>
                <KvLine label="결과">
                  회귀 시험 점수가 떨어져 이전 버전으로 되돌리기를 제안합니다
                </KvLine>
              </div>
              <BtnRow>
                <Btn primary disabled={busy} onClick={() => void applyRevert(pending)}>
                  되돌리기 반영
                </Btn>
                <Btn
                  disabled={busy}
                  onClick={() =>
                    router.push("/settings?tab=luna&luna=brain&sub=prompts")
                  }
                >
                  수정해서 반영
                </Btn>
                <Btn disabled={busy} onClick={() => void dismiss()}>
                  반려
                </Btn>
                <BtnNote>되돌리면 이전 내용이 새 버전으로 기록됩니다</BtnNote>
              </BtnRow>
            </BrainCard>
          ) : (
            <BrainCard>
              <p className="text-[13px]" style={{ color: K.sub }}>
                사람이 판단할 개선 제안이 없습니다.
                {data?.last_run?.message
                  ? ` 마지막 점검: ${data.last_run.message}`
                  : ""}
              </p>
            </BrainCard>
          )}

          <SectionTitle className="mt-4">개선 이력</SectionTitle>
          {history.length === 0 ? (
            <p className="text-[12px]" style={{ color: K.faint }}>
              아직 프롬프트 변경 이력이 없습니다.
            </p>
          ) : (
            <ListCard>
              {history.map((item) => (
                <div
                  key={item.id}
                  className="border-b px-4 py-[13px] last:border-b-0"
                  style={{ borderColor: K.line2 }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {item.changed_by_luna ? (
                      <Badge kind="wait">루나</Badge>
                    ) : (
                      <Badge kind="src">사람</Badge>
                    )}
                    <span
                      className="min-w-0 flex-1 truncate text-[13px]"
                      style={{ color: item.reverted_later ? K.sub : K.ink }}
                    >
                      {promptLabel(item)}
                    </span>
                    <ScoreBadge item={item} />
                    <span className="text-[11.5px]" style={{ color: K.faint }}>
                      {formatMonthDay(item.created_at)}
                      {item.editor_name ? ` · ${item.editor_name}` : ""}
                    </span>
                  </div>
                  {item.changed_by_luna && item.change_summary ? (
                    <p className="mt-1.5 text-[12px]" style={{ color: K.sub }}>
                      {clipText(item.change_summary, 120)}
                    </p>
                  ) : null}
                </div>
              ))}
            </ListCard>
          )}

          <RunBar text="자동 점검 매주 일요일 04:00 · 한 번에 한 프롬프트만">
            <Btn disabled={busy} onClick={() => void runNow()}>
              {busy ? "점검 중…" : "지금 점검"}
            </Btn>
          </RunBar>
        </>
      ) : null}
    </KnowledgeShell>
  );
}
