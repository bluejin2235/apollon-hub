"use client";

export type MetricHint = {
  id: string;
  title: string;
  /** 카드 안에 항상 보이는 짧은 한 줄. 긴 설명은 패널에만 둔다. */
  summary: string;
  definition: string;
  criterion: string;
  action: string;
  limit: string;
};

export function MetricHintButton({
  hint,
  open,
  panelId,
  onToggle
}: {
  hint: MetricHint;
  open: boolean;
  panelId: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="ws-q"
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={`${hint.title} 설명`}
      onClick={onToggle}
    >
      ?
    </button>
  );
}

/** KPI 카드 줄 전체 아래에 뜨는 가로 패널. 어느 물음표를 눌러도 같은 자리다. */
export function MetricHintPanel({
  id,
  hint,
  onClose
}: {
  id: string;
  hint: MetricHint;
  onClose: () => void;
}) {
  return (
    <div className="ws-hint-panel" id={id} role="region" aria-label={`${hint.title} 설명`}>
      <div className="ws-hint-head">
        <span className="ws-hint-title">{hint.title}</span>
        <button type="button" className="ws-hint-close" onClick={onClose}>
          닫기
        </button>
      </div>
      <p className="ws-hint-row">
        <b>정의</b>
        <span>{hint.definition}</span>
      </p>
      <p className="ws-hint-row">
        <b>기준</b>
        <span>{hint.criterion}</span>
      </p>
      <p className="ws-hint-row">
        <b>할 일</b>
        <span>{hint.action}</span>
      </p>
      <p className="ws-hint-row">
        <b>한계</b>
        <span>{hint.limit}</span>
      </p>
    </div>
  );
}
