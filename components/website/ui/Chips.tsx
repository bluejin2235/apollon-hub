"use client";

import "./work-admin.css";

export type ChipItem = {
  id: string;
  label: string;
};

type ChipsProps = {
  items: ChipItem[];
  onRemove?: (id: string) => void;
  onAdd?: () => void;
  addLabel?: string;
};

export function Chips({
  items,
  onRemove,
  onAdd,
  addLabel = "＋ 추가",
}: ChipsProps) {
  return (
    <div className="wa chips">
      {items.map((item) => (
        <span key={item.id} className="chip">
          {item.label}
          {onRemove ? (
            <button
              type="button"
              className="x"
              aria-label={`${item.label} 삭제`}
              onClick={() => onRemove(item.id)}
            >
              ✕
            </button>
          ) : null}
        </span>
      ))}
      {onAdd ? (
        <button type="button" className="chip add" onClick={onAdd}>
          {addLabel}
        </button>
      ) : null}
    </div>
  );
}
