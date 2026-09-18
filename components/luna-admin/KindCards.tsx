"use client";

import type { PrimaryKindCard } from "@/lib/luna-admin/types";

type Props = {
  cards: PrimaryKindCard[];
  selected?: string | null;
  onSelect?: (id: string) => void;
  onAsk?: (id: string) => void;
  cols?: 4 | 5;
};

export function KindCards({ cards, selected, onSelect, onAsk, cols = 5 }: Props) {
  return (
    <div className={`kcards c${cols}`}>
      {cards.map((card) => {
        const on = selected === card.id;
        const deltaCls = card.delta != null && card.delta > 0 ? "up" : "flat";
        return (
          <button
            key={card.id}
            type="button"
            className={`kcard ${card.tone}${on ? " on" : ""}`}
            onClick={() => onSelect?.(card.id)}
          >
            <span className={`bar ${card.tone}`} />
            <div className="hd">
              <span className={`ic ${card.tone}`}>{card.ic}</span>
              <span className="nm">{card.label}</span>
              {onAsk ? (
                <span
                  className="q"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAsk(card.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      onAsk(card.id);
                    }
                  }}
                >
                  ?
                </span>
              ) : null}
            </div>
            <div className="v">{card.count.toLocaleString("ko-KR")}</div>
            <div className="d">{card.note}</div>
            <div className={`delta ${deltaCls}`}>{card.delta_label}</div>
          </button>
        );
      })}
    </div>
  );
}
