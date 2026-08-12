"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Box,
  BoxRow,
  Btn,
  ErrorLine,
  KnowledgeShell,
  ListCard,
  ListItem,
  LoadingLine,
  Meta
} from "@/components/luna/knowledge/ui";
import { formatKnowledgeDate, K } from "@/lib/luna/knowledge-format";
import { supabase } from "@/lib/supabase/client";

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export function LunaKnowledgeNotion() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState("");

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      setError("로그인이 필요합니다");
      return;
    }
    const res = await fetch("/api/luna/engine", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setError(`불러오기 실패: ${await res.text()}`);
      setLoading(false);
      return;
    }
    const json = (await res.json()) as {
      connections?: { notion?: boolean };
    };
    setConnected(json.connections?.notion === true);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function testConnection() {
    setTesting(true);
    setTestNote("");
    try {
      if (!connected) {
        setTestNote("NOTION_TOKEN 환경 변수가 설정되지 않았습니다.");
        return;
      }
      setTestNote(`마지막 확인 ${formatKnowledgeDate(new Date().toISOString())}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <KnowledgeShell>
      {loading ? <LoadingLine /> : null}
      {error ? <ErrorLine message={error} /> : null}

      {!loading && !error ? (
        <>
          <div
            className="mb-3.5 flex items-center gap-3 rounded-[12px] border px-4 py-[13px]"
            style={{ background: K.panel, borderColor: K.line }}
          >
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ background: connected ? K.talk : K.faint }}
            />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-bold">
                {connected ? "연결됨" : "미연결"}
              </div>
              <div className="text-[12px]" style={{ color: K.sub }}>
                {connected
                  ? `통합 토큰 정상${testNote ? ` · ${testNote}` : ""}`
                  : "NOTION_TOKEN을 설정하면 검색 API를 사용합니다"}
              </div>
            </div>
            <Btn disabled={testing} onClick={() => void testConnection()}>
              {testing ? "확인 중…" : "연결 테스트"}
            </Btn>
          </div>

          <ListCard>
            <div className="flex flex-wrap items-center gap-2 px-4 py-[13px] pb-2">
              <div className="min-w-[200px] flex-1">
                <div className="text-[13px] font-bold">검색 대상 워크스페이스</div>
                <div className="text-[11.5px]" style={{ color: K.sub }}>
                  노션 API는 팀스페이스 단위 설정을 지원하지 않아, 토큰이 접근 가능한
                  전체 페이지·DB가 검색 대상입니다
                </div>
              </div>
              <Btn disabled>대상 추가</Btn>
            </div>

            {connected ? (
              <ListItem>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-bold">통합 검색 범위</span>
                  <Badge kind="ok">연결됨</Badge>
                  <Meta>토큰 권한 내 전체</Meta>
                </div>
                <p className="mt-1.5 text-[12px]" style={{ color: K.sub }}>
                  포함: 통합 토큰이 접근할 수 있는 모든 페이지·데이터베이스
                </p>
              </ListItem>
            ) : (
              <ListItem>
                <p className="text-[13px]" style={{ color: K.faint }}>
                  노션이 연결되지 않았습니다.
                </p>
              </ListItem>
            )}
          </ListCard>

          <div className="mt-3.5 grid grid-cols-1 gap-3.5 min-[901px]:grid-cols-[1.15fr_1fr]">
            <Box title="검색 규칙">
              <BoxRow left="내부 지식·트렌드" right="노션 우선" />
              <BoxRow left="결과 없을 때" right="웹으로 보완" />
              <BoxRow left="출처 표기" right="노션 / 웹 구분" />
              <p className="mt-2.5 text-[11px]" style={{ color: K.faint }}>
                규칙은 두뇌 → L3-03 자료 찾기에서 관리합니다
              </p>
            </Box>

            <Box title="최근 조회">
              <p className="text-[12px]" style={{ color: K.faint }}>
                조회 이력 테이블이 없어 표시하지 않습니다.
              </p>
            </Box>
          </div>
        </>
      ) : null}
    </KnowledgeShell>
  );
}
