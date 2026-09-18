export type QaKind = "rule" | "answer" | "skip";

export type QaOption = {
  id: string;
  label: string;
  sub?: string;
};

export type QaPair = {
  left: { name: string; path: string };
  right: { name: string; path: string };
};

export type QaItem = {
  kind: QaKind;
  ref_id: string;
  ref_ids?: string[];
  question: string;
  why?: string;
  impact?: number;
  options: QaOption[];
  pairs?: QaPair[];
  samples?: string[];
  flags?: string[];
  metrics?: string;
  evidence_title?: string;
  stats?: string[];
  pattern_value?: string;
  /** buildQaItems 선정 기준. 바뀌면 열린 세션을 버리고 다시 만든다. */
  list_version?: number;
};

export function ruleOptions(item: {
  pattern_type?: string;
  pattern_value?: string;
  n: number;
}): QaOption[] {
  const n = item.n > 0 ? item.n : 0;
  const inspect: QaOption = {
    id: "inspect",
    label: item.pattern_value?.startsWith("answer_flag:")
      ? "근거만 더 볼게요"
      : n
        ? `${n}건을 먼저 볼게요`
        : "근거를 먼저 볼게요",
    sub: "보고 나서 정할게요"
  };
  const other: QaOption = {
    id: "other",
    label: "기타 — 직접 말할게요",
    sub: "눌러서 말하면 됩니다"
  };
  if (item.pattern_type === "stopword") {
    return [
      { id: "accept", label: "빼주세요", sub: "이름 비교에서 빼겠습니다" },
      { id: "reject", label: "그대로 두세요", sub: "지금은 규칙을 만들지 않아요" },
      inspect,
      other
    ];
  }
  if (
    item.pattern_value === "same_client_diff_target" ||
    item.pattern_value === "same_client_diff_job"
  ) {
    return [
      {
        id: "accept",
        label: "다른 건이 맞아요",
        sub: "발주처만 같으면 묶지 않을게요"
      },
      {
        id: "reject",
        label: "같은 건일 수도 있어요",
        sub: "지금처럼 하나씩 물어볼게요"
      },
      inspect,
      other
    ];
  }
  if (item.pattern_value === "answer_flag:source_skew") {
    return [
      { id: "accept", label: "더 볼게요", sub: "Work서버를 같이 보게 할게요" },
      { id: "reject", label: "노션만으로도 됐어요", sub: "지금은 그대로 둘게요" },
      inspect,
      other
    ];
  }
  if (item.pattern_value === "answer_flag:slow") {
    return [
      { id: "accept", label: "빨리 하게 해 주세요", sub: "검색을 줄이겠습니다" },
      { id: "reject", label: "지금은 괜찮아요", sub: "규칙을 만들지 않아요" },
      inspect,
      other
    ];
  }
  if (item.pattern_value === "answer_flag:scope_excess") {
    return [
      { id: "accept", label: "줄여 주세요", sub: "용어는 위키·용어사전만" },
      { id: "reject", label: "지금은 그대로", sub: "규칙을 만들지 않아요" },
      inspect,
      other
    ];
  }
  if (item.pattern_value === "answer_flag:unused_sources") {
    return [
      {
        id: "accept",
        label: "범위를 줄여 주세요",
        sub: "찾아 놓고 안 쓰는 일이 줄어들게"
      },
      { id: "reject", label: "지금은 그대로", sub: "규칙을 만들지 않아요" },
      inspect,
      other
    ];
  }
  return [
    { id: "accept", label: "맞아요", sub: "이 규칙으로 정리할게요" },
    { id: "reject", label: "아니요", sub: "지금은 적용하지 않아요" },
    inspect,
    other
  ];
}

export function answerOptions(): QaOption[] {
  return [
    { id: "good", label: "맞아요" },
    { id: "wrong_answer", label: "찾긴 했는데 답이 틀렸다" },
    { id: "bad", label: "틀려요" },
    { id: "other", label: "기타 — 직접 말할게요", sub: "눌러서 말하면 됩니다" }
  ];
}

export function skipOptions(item?: { skip_reason?: string; why?: string }): QaOption[] {
  const why = (item?.skip_reason ?? item?.why ?? "").trim();
  return [
    {
      id: "ack",
      label: "알겠어요",
      sub: why ? why.slice(0, 48) : "오늘은 넘어갈게요"
    },
    { id: "can_study", label: "자습이 해도 돼요" },
    { id: "hold", label: "아직 모르겠어요" },
    { id: "other", label: "기타 — 직접 말할게요" }
  ];
}

export type QaPending = {
  transcript: string;
  current: { summary: string; accept: boolean | null };
  extra: { summary: string } | null;
};

export type QaAnswer = {
  index: number;
  kind: QaKind;
  ref_id: string;
  option_id: string;
  transcript?: string;
  applied?: boolean;
  impact?: number;
};

export type QaSummary = {
  asked: number;
  resolved: number;
  rules: Array<{ text: string; impact: number }>;
  answers: { good: number; bad: number; skip: number };
};

export type QaSessionView = {
  id: string;
  user_id: string;
  conversation_id: string | null;
  items: QaItem[];
  cursor: number;
  answers: QaAnswer[];
  pending: QaPending | null;
  started_at: string;
  finished_at: string | null;
  summary: QaSummary | null;
};

export function confirmOptions(hasExtra: boolean): QaOption[] {
  if (hasExtra) {
    return [
      { id: "both", label: "맞아요 — 둘 다 그렇게 해주세요" },
      { id: "first_only", label: "1번만 맞아요", sub: "새 규칙은 다시 말할게요" },
      { id: "retry", label: "다시 말할게요" }
    ];
  }
  return [
    { id: "both", label: "맞아요" },
    { id: "retry", label: "다시 말할게요" }
  ];
}
