"use client";

import Link from "next/link";
import { KnowledgeShell } from "@/components/luna/knowledge/ui";
import { K } from "@/lib/luna/knowledge-format";

export function LunaKnowledgeWiki() {
  return (
    <KnowledgeShell>
      <p className="mb-3 text-[12.5px]" style={{ color: K.sub }}>
        양식·기준·규정·용어사전은 Apollon Wikipedia에서 관리합니다. 두뇌 라이브러리
        탭은 없습니다.
      </p>
      <div className="flex flex-col gap-2 text-[13px]">
        <Link href="/wiki/terms" style={{ color: "#534AB7" }}>
          용어사전
        </Link>
        <Link href="/wiki/forms" style={{ color: "#534AB7" }}>
          양식
        </Link>
        <Link href="/wiki/standards" style={{ color: "#534AB7" }}>
          기준
        </Link>
        <Link href="/wiki/rules" style={{ color: "#534AB7" }}>
          규정
        </Link>
      </div>
      <p className="mt-4 text-[11.5px]" style={{ color: K.faint }}>
        규정만 슈퍼관리자가 고칩니다. 나머지는 누구나 고칠 수 있고, 저장하면 루나가
        바로 씁니다.
      </p>
    </KnowledgeShell>
  );
}
