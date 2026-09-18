"use client";

import { ADMIN_SELFSTUDY_HOUR, ADMIN_SELFSTUDY_MINUTE } from "@/lib/luna-admin/schedule";

const STUDY_BUDGET_MINUTES = 60;
const STUDY_DAILY_COST_USD = 1;
const MODE_A_MULTI_FROM = "2026-09-19";

const SOURCE_ROWS: Array<{
  key: string;
  label: string;
  daily: number;
  questions: number;
  llm: string;
  minutes: number;
}> = [
  { key: "glossary", label: "용어사전", daily: 100, questions: 100, llm: "불필요", minutes: 4 },
  { key: "image", label: "이미지", daily: 200, questions: 200, llm: "불필요", minutes: 5 },
  { key: "knowledge", label: "아폴론 지식", daily: 20, questions: 20, llm: "불필요", minutes: 2 },
  { key: "wiki", label: "위키", daily: 15, questions: 45, llm: "질문 생성", minutes: 6 },
  { key: "notion", label: "노션", daily: 100, questions: 300, llm: "질문 생성", minutes: 14 },
  { key: "work", label: "Work 본문", daily: 100, questions: 300, llm: "질문 생성", minutes: 14 }
];

function todayKstKey(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export function LunaAdminSelfstudySettings() {
  const hh = String(ADMIN_SELFSTUDY_HOUR).padStart(2, "0");
  const mm = String(ADMIN_SELFSTUDY_MINUTE).padStart(2, "0");
  const multi = todayKstKey() >= MODE_A_MULTI_FROM;
  const fromLabel = MODE_A_MULTI_FROM.slice(5).replace("-", "/");

  return (
    <>
      <div className="sech">
        <span className="t">언제 돌까</span>
      </div>
      <div className="setrow">
        <div className="c">
          <div className="t">자습 시각</div>
          <div className="d">
            이미지·색인·2차 데이터가 끝난 뒤. 아침 리포트(07:00) 전에 끝나야 합니다.
          </div>
        </div>
        <span className="v">
          {hh}:{mm}
        </span>
      </div>
      <div className="setrow">
        <div className="c">
          <div className="t">하루 시간 상한</div>
          <div className="d">넘으면 다음날로 넘깁니다. 청크 하나가 끝난 뒤에 멈춥니다.</div>
        </div>
        <span className="v">{STUDY_BUDGET_MINUTES}분</span>
      </div>
      <div className="setrow">
        <div className="c">
          <div className="t">하루 비용 상한</div>
          <div className="d">넘으면 중단하고 아침 리포트에 표시합니다.</div>
        </div>
        <span className="v">${STUDY_DAILY_COST_USD.toFixed(2)}</span>
      </div>

      <div className="sech">
        <span className="t">무엇을 할까</span>
      </div>
      <div className="setrow">
        <div className="c">
          <div className="t">정답 없는 것은 자동으로 하지 않는다</div>
          <div className="d">
            스스로 채점할 수 없으면 틀린 것을 확신하며 쌓습니다. <b>끄지 마세요.</b>
          </div>
        </div>
        <span className="tog" aria-hidden />
      </div>
      <div className="setrow">
        <div className="c">
          <div className="t">모드 A 를 매일 1순위로</div>
          <div className="d">
            끄면 실패 질문(모드 B)이 1순위가 되고, 그건 자동으로 배울 수 없습니다.
          </div>
        </div>
        <span className="tog" aria-hidden />
      </div>
      <div className="setrow">
        <div className="c">
          <div className="t">같은 아젠다를 하루에 두 번 고르지 않는다</div>
          <div className="d">같은 것을 여러 번 골라 헛도는 일을 막습니다.</div>
        </div>
        <span className="tog" aria-hidden />
      </div>
      <div className="setrow">
        <div className="c">
          <div className="t">여섯 원천으로 넓히기</div>
          <div className="d">
            용어·이미지·지식·위키·Work·노션. <b>{fromLabel} 부터</b>
            {multi ? " · 켜짐" : " · 아직 꺼짐"}
          </div>
        </div>
        <span className={`tog${multi ? "" : " off"}`} aria-hidden />
      </div>

      <div className="sech">
        <span className="t">원천별 하루 분량</span>
        <span className="sp" />
        <span className="n">{fromLabel} 부터 적용</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>원천</th>
            <th className="num">하루</th>
            <th className="num">문항</th>
            <th>LLM</th>
            <th className="num">분</th>
          </tr>
        </thead>
        <tbody>
          {SOURCE_ROWS.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td className="num">{row.daily}</td>
              <td className="num">{row.questions}</td>
              <td className="mut">{row.llm}</td>
              <td className="num">{row.minutes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
