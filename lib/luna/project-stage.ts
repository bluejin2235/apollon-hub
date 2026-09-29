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
  /01\s*사업개발|\[(?:진행\s*중|완료)\]\s*사업개발|영업\s*및\s*사업개발|아이데이션\s*DB/i;

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
  // BD(사업개발) 공간
  if (/BD\s*전용|[/\\]BD\b/i.test(hay)) return "proposal";

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

  // 경로 불명일 때 제목 힌트 (제안서·아이데이션 등)
  const title = opts.title ?? "";
  if (/제안|아이데이션|ideation|컨셉\s*디자인|RFP|입찰/i.test(title)) {
    return "proposal";
  }

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
    if (stage === "executed") return 1.45;
    if (stage === "proposal") return 0.35;
    return 0.75;
  }
  // prefer_proposal — 수행(02 Project)을 강하게 밀어 사업개발이 위로 오게
  if (stage === "proposal") return 1.55;
  if (stage === "executed") return 0.28;
  return 0.8;
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
- Work서버·노션의 「02 Project / [진행 중·완료] 프로젝트」는 수행 프로젝트의 보관 분류다. 그 안의 제안·아이데이션·리서치 문서가 실제 시공 완료를 증명하지는 않는다.
- 「01 사업개발 / [진행 중·완료] 사업개발」은 사업개발의 보관 분류다. 현재 진행 건과 변경된 범위도 관련 자료에 포함한다.
- 「설치 사례·구축 사례·완성·준공」을 물으면 수행 자료를 우선하고, 제안 단계 문서만 있으면 「제안만 한 것」이라고 밝혀라. 제안서를 설치 사례로 단정하지 마라.
- 「제안·아이데이션·검토·RFP」를 물으면 사업개발 쪽을 우선하라.
- 전체 관련 자료를 물으면 프로젝트별로 묶고 문서의 기획·회의·검토·테스트·준공 단계를 본문 근거로 표시한다. 완료 사례만 요청한 것으로 좁히지 않는다.
- 자료의 [수행]/[제안] 표시는 보관 분류의 단서다. 실제 역할·설치 여부는 원문을 우선하며, 폴더 분류와 원문이 다르면 원문에 따른다.`;
