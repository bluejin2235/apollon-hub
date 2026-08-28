import { isBlockNameCaption } from "@/lib/website/text-dup";

export function TextDupHint({
  kind,
  value,
  count,
  checkBlockName
}: {
  kind: "caption" | "alt";
  value: string;
  count: number;
  checkBlockName?: boolean;
}) {
  const dup = count >= 2;
  const blockName = Boolean(checkBlockName && isBlockNameCaption(value));
  if (!dup && !blockName) return null;
  const noun = kind === "caption" ? "캡션" : "대체 텍스트";
  return (
    <div className="mt-1 space-y-0.5" style={{ color: "#b0231e", fontSize: 12, lineHeight: 1.45 }}>
      {dup ? (
        <>
          <p>이 {noun}이 이 워크에서 {count}번 쓰였습니다.</p>
          <p>같은 문장이 반복되면 AI 가 인용하지 않습니다.</p>
        </>
      ) : null}
      {blockName ? <p>블록 이름은 캡션이 아닙니다. 무엇이 찍혔는지 적어주세요.</p> : null}
    </div>
  );
}
