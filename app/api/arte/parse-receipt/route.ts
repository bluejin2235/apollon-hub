import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export async function POST(req: NextRequest) {
  try {
    const { base64, mediaType } = (await req.json()) as {
      base64: string;
      mediaType: string;
    };

    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    const safeMediaType = allowedTypes.includes(mediaType) ? mediaType : "image/jpeg";

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: safeMediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                data: base64
              }
            },
            {
              type: "text",
              text: `이 이미지는 AI 서비스 결제 영수증 또는 결제 화면입니다.
다음 정보를 JSON으로만 응답해줘. 다른 텍스트 없이 JSON만.
{
  "service_name": "서비스명 (예: Hailuo, Kling, OpenAI, Anthropic)",
  "payment_type": "크레딧 또는 초과결제 또는 기타",
  "amount_krw": "금액 숫자만 (원화로, 콤마 없이, 예: 45000)",
  "paid_at": "결제날짜 YYYY-MM-DD 형식",
  "memo": "간단한 메모 (없으면 빈 문자열)"
}
금액이 달러면 1500을 곱해서 원화로 변환해줘.
확실하지 않은 필드는 빈 문자열로 반환해줘.`
            }
          ]
        }
      ]
    });

    const text = message.content.find((c) => c.type === "text")?.text ?? "{}";
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return NextResponse.json(parsed);
  } catch (e) {
    console.error("[parse-receipt]", e);
    return NextResponse.json({}, { status: 500 });
  }
}
