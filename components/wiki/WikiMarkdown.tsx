"use client";

import Link from "next/link";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { W } from "@/components/wiki/wiki-theme";

const components: Components = {
  a: ({ href, children }) => {
    const className =
      "underline decoration-[#DDD9F2] underline-offset-2";
    const style = { color: W.luna };
    if (href?.startsWith("/")) {
      return (
        <Link href={href} className={className} style={style}>
          {children}
        </Link>
      );
    }
    return (
      <a href={href} className={className} style={style}>
        {children}
      </a>
    );
  },
  ul: ({ children }) => (
    <ul className="my-1 ml-[17px] list-disc">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1 ml-[17px] list-decimal">{children}</ol>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  )
};

export function WikiMarkdown({ text }: { text: string }) {
  return (
    <div
      className="text-[13px] leading-[1.9]"
      style={{ color: "#2a2c31" }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text || ""}
      </ReactMarkdown>
    </div>
  );
}
