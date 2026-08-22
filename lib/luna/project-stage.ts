/**
 * 제안 단계 vs 수행 프로젝트 — 경로·노션 계층으로 판정 (조회 시 계산, DB 컬럼 없음).
 *
 * 이유: nas_path · path_titles 에 이미 구분이 있고, 규칙이 자주 바뀔 수 있어
 * 재색인 비용 없이 즉시 반영하는 편이 낫다.
 */

export type WorkStage = "executed" | "proposal" | "unknown";

export type StageQueryBias = "prefer_executed" | "prefer_proposal" | "neutral";

const EXECUTED_PATH_RE =
  /02\s*Project|\[(?:진행\s*중|완료)\]\s*프로젝트/i;
const PROPOSAL_PATH_RE =
  /01\s*사업개발|\[(?:진행\s*중|완료)\]\s*사업개발/i;

/** 질문에 「수행」을 가리키는 말 */
const QUERY_EXECUTED_RE =
  /설치\s*사례|구축\s*사례|완성작?|준공|오픈|납품|시공|실제로\s*한|우리가\s*만든|포트폴리오|우리\s*레퍼런스/;

/** 질문에 「제안」을 가리키는 말 */
const QUERY_PROPOSAL_RE =
  /제안|아이데이션|검토|컨셉|concept|RFP|수주|입찰/;

export function workStageLabel(stage: WorkStage): string {
  if (stage === "executed") return "수행";
  if (stage === "proposal") return "제안";
  return "불명";
}

export function workStageBadgeText(stage: WorkStage): string | null {
  if (stage === "executed") return "수행";
  if (stage === "proposal") return "제안";
  return null;
}

export function detectWorkStage(opts: {
  nasPath?: string | null;
  paths?: string[] | null;
  pathTitles?: string[] | null;
  drive?: string | null;
  title?: string | null;
}): WorkStage {
  const pathBlob = [
    opts.nasPath ?? "",
    ...(opts.paths ?? []),
    opts.title ?? ""
  ].join("\n");
  const titleBlob = (opts.pathTitles ?? []).join("\n");
  const hay = `${pathBlob}\n${titleBlob}`;

  // 노션 계층·경로에 명시된 구분 우선
  if (EXECUTED_PATH_RE.test(hay)) return "executed";
  if (PROPOSAL_PATH_RE.test(hay)) return "proposal";

  const drive =
    (opts.drive ?? "").toUpperCase() ||
    (opts.nasPath?.match(/^([A-Za-z]):/)?.[1] ?? "").toUpperCase();

  // P: — 01 사업개발만 제안, 그 외 프로젝트 폴더는 수행
  if (drive === "P" || /^P:\\/i.test(opts.nasPath ?? "")) {
    if (/P:\\?\s*01\s*사업개발|[/\\]01\s*사업개발/i.test(hay)) {
      return "proposal";
    }
    if (/P:\\/i.test(opts.nasPath ?? "") || drive === "P") {
      return "executed";
    }
  }

  if (/T:\\?\s*02\s*Project|[/\\]02\s*Project/i.test(hay)) return "executed";
  if (/T:\\?\s*01\s*사업개발|[/\\]01\s*사업개발/i.test(hay)) return "proposal";

  return "unknown";
}

export function detectStageQueryBias(question: string): StageQueryBias {
  const q = question.replace(/\s+/g, " ").trim();
  if (!q) return "neutral";
  const wantExec = QUERY_EXECUTED_RE.test(q) || (/\b사례\b|사례를|사례가/.test(q) && !QUERY_PROPOSAL_RE.test(q));
  const wantProp = QUERY_PROPOSAL_RE.test(q);
  if (wantExec && !wantProp) return "prefer_executed";
  if (wantProp && !wantExec) return "prefer_proposal";
  if (wantExec && wantProp) {
    // 둘 다 있으면 앞쪽 신호가 강한 쪽 — 「설치 사례」가 제안보다 구체적이면 수행
    if (QUERY_EXECUTED_RE.test(q)) return "prefer_executed";
    return "prefer_proposal";
  }
  return "neutral";
}

export function stageScoreMultiplier(
  stage: WorkStage,
  bias: StageQueryBias
): number {
  if (bias === "neutral") return 1;
  if (bias === "prefer_executed") {
    if (stage === "executed") return 1.4;
    if (stage === "proposal") return 0.45;
    return 0.85;
  }
  if (stage === "proposal") return 1.4;
  if (stage === "executed") return 0.7;
  return 0.85;
}

/** match_score(하이브리드) 또는 similarity×10 에 단계 가중 적용 */
export function boostMatchScoreForStage(
  matchScore: number | undefined,
  similarity: number | undefined,
  stage: WorkStage,
  bias: StageQueryBias
): number {
  const base =
    typeof matchScore === "number" && Number.isFinite(matchScore)
      ? matchScore
      : (similarity ?? 0) * 10;
  return base * stageScoreMultiplier(stage, bias);
}

export const WORK_STAGE_ANSWER_RULE = `[수행·제안 구분]
- Work서버·노션의 「02 Project / [진행 중·완료] 프로젝트」는 실제 구축·수행이다.
- 「01 사업개발 / [진행 중·완료] 사업개발」은 제안·수주 전 단계다.
- 「설치 사례·구축 사례·완성·준공」을 물으면 수행 자료를 우선하고, 제안 단계 문서만 있으면 「제안만 한 것」이라고 밝혀라. 제안서를 설치 사례로 단정하지 마라.
- 「제안·아이데이션·검토·RFP」를 물으면 사업개발 쪽을 우선하라.
- 답할 때 가능하면 「실제 구축한 것은 …, 제안 단계에서 검토한 것은 …」처럼 단계를 나눠 말하라.
- 자료에 [수행]/[제안] 표시가 있으면 그에 따르라.`;
