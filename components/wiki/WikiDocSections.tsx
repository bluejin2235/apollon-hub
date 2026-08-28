"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { WikiBodyView } from "@/components/wiki/WikiBodyView";
import {
  buildWikiSectionTree,
  isWikiSubSectionTitle,
  type WikiSectionNode
} from "@/lib/wiki/section-layout";
import type { WikiSection } from "@/lib/wiki/types";
import "@/components/wiki/wiki-sections.css";

function sectionSummary(body: string): string {
  const plain = body.replace(/\r\n/g, "\n").trim();
  if (!plain) return "";

  const firstLine =
    plain
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";

  const stripped = firstLine
    .replace(/^\s*##\s+/, "")
    .replace(/^\s*(?:-\s+|·\s+|\d+\.\s+)/, "")
    .replace(/\*\*/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\|.*\|$/, "")
    .trim();

  if (!stripped) return "";
  if (stripped.length <= 40) return stripped;
  return `${stripped.slice(0, 40)}…`;
}

type Props = {
  sections: WikiSection[];
  canEdit: boolean;
  editHref: (sectionId: string) => string;
};

type SectionCardProps = {
  node: WikiSectionNode;
  nested?: boolean;
  collapsed: Set<string>;
  canEdit: boolean;
  editHref: (sectionId: string) => string;
  onToggle: (id: string) => void;
};

function SectionCard({
  node,
  nested = false,
  collapsed,
  canEdit,
  editHref,
  onToggle
}: SectionCardProps) {
  const { section, children } = node;
  const isCollapsed = collapsed.has(section.id);
  const summary = sectionSummary(section.body);
  const hasChildren = children.length > 0;

  return (
    <article
      id={section.id}
      className={`wiki-section-card${nested ? " is-child" : ""}`}
    >
      <div
        className={`wiki-section-head${isCollapsed ? " is-collapsed" : ""}${
          nested ? " is-child-head" : ""
        }`}
        role="button"
        tabIndex={0}
        aria-expanded={!isCollapsed}
        onClick={() => onToggle(section.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle(section.id);
          }
        }}
      >
        {isCollapsed && summary ? (
          <span className="wiki-section-summary" title={section.title}>
            <span className="font-semibold text-[#374151]">{section.title}</span>
            <span className="mx-1.5 text-[#d1d5db]">·</span>
            {summary}
          </span>
        ) : (
          <span
            className={`wiki-section-title${nested ? " is-child-title" : ""}`}
          >
            {section.title}
          </span>
        )}
        {canEdit ? (
          <Link
            href={editHref(section.id)}
            className="wiki-section-edit"
            onClick={(e) => e.stopPropagation()}
          >
            고치기
          </Link>
        ) : null}
        <span
          className={`wiki-section-chevron${isCollapsed ? " is-collapsed" : ""}`}
          aria-hidden
        >
          ▼
        </span>
      </div>
      {!isCollapsed ? (
        <>
          <div className="wiki-section-body">
            <WikiBodyView text={section.body} />
          </div>
          {hasChildren ? (
            <div className="wiki-section-children">
              {children.map((child) => (
                <SectionCard
                  key={child.section.id}
                  node={child}
                  nested
                  collapsed={collapsed}
                  canEdit={canEdit}
                  editHref={editHref}
                  onToggle={onToggle}
                />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </article>
  );
}

export function WikiDocSections({ sections, canEdit, editHref }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [tocOpen, setTocOpen] = useState(false);

  const tree = useMemo(() => buildWikiSectionTree(sections), [sections]);
  const sectionIds = useMemo(() => sections.map((s) => s.id), [sections]);

  const allCollapsed = sections.length > 0 && collapsed.size >= sections.length;
  const allExpanded = collapsed.size === 0;

  function toggleSection(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function collapseAll() {
    setCollapsed(new Set(sectionIds));
  }

  function expandAll() {
    setCollapsed(new Set());
  }

  if (sections.length === 0) return null;

  return (
    <div>
      {sections.length >= 2 ? (
        <nav className="wiki-section-toc" aria-label="목차">
          <button
            type="button"
            className="wiki-section-toc-toggle"
            onClick={() => setTocOpen((v) => !v)}
            aria-expanded={tocOpen}
          >
            <span>{tocOpen ? "목차 접기" : "목차 보기"}</span>
            <span className="text-[10px] font-normal text-[#9aa0a8]">
              {sections.length}개 절
            </span>
          </button>
          {tocOpen ? (
            <div className="wiki-section-toc-list">
              <ol>
                {sections.map((section) => (
                  <li
                    key={section.id}
                    className={isWikiSubSectionTitle(section.title) ? "is-child" : undefined}
                  >
                    <a href={`#${section.id}`}>{section.title}</a>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </nav>
      ) : null}

      {sections.length >= 2 ? (
        <div className="wiki-section-toolbar">
          <button
            type="button"
            className="wiki-section-toolbar-btn"
            onClick={collapseAll}
            disabled={allCollapsed}
          >
            전체 접기
          </button>
          <button
            type="button"
            className="wiki-section-toolbar-btn"
            onClick={expandAll}
            disabled={allExpanded}
          >
            전체 펼치기
          </button>
        </div>
      ) : null}

      {tree.map((node) => (
        <SectionCard
          key={node.section.id}
          node={node}
          collapsed={collapsed}
          canEdit={canEdit}
          editHref={editHref}
          onToggle={toggleSection}
        />
      ))}
    </div>
  );
}
