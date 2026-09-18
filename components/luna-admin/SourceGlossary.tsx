"use client";

import type { SourceGlossaryTerm } from "@/lib/luna-admin/source-glossary";

type Props = {
  terms: SourceGlossaryTerm[];
  open: boolean;
  focusId?: string | null;
  onToggle: () => void;
};

export function SourceGlossary({ terms, open, focusId, onToggle }: Props) {
  if (!open) {
    return (
      <button type="button" className="glo-closed" onClick={onToggle}>
        이 화면의 말 ▾
      </button>
    );
  }
  return (
    <div className="glo">
      <div className="gt">
        이 화면의 말
        <button type="button" className="x" onClick={onToggle}>
          접기 ▴
        </button>
      </div>
      {terms.map((term) => (
        <div key={term.id} className={`row${focusId === term.id ? " on" : ""}`} id={`glo-${term.id}`}>
          <span className="w">{term.word}</span>
          <span className="dd">{term.def}</span>
        </div>
      ))}
    </div>
  );
}
