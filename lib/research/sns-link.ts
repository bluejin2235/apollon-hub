import { extractFirstUrl } from "@/lib/research/types";

const SNS_HOSTS = ["instagram.com", "instagr.am", "facebook.com", "fb.com", "fb.watch"] as const;

const URL_REGEX = /https?:\/\/[^\s<>"']+/gi;

export const SNS_LUNA_REPLY = `인스타그램/페이스북 링크는 직접 열어볼 수 없어서 내용 분석은 어려워요.
링크는 저장해두을게요 — 위클리 리포트 작업 때 편집장이 직접 확인하고 선별할 수 있어요. 📎
어떤 내용인지 간단히 메모해주시면 나중에 큐레이팅할 때 도움이 돼요!`;

function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

export function isSnsHost(hostname: string): boolean {
  return SNS_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

/** 텍스트에서 첫 SNS 링크 URL 추출. 없으면 null. */
export function extractSnsUrl(text: string): string | null {
  const urls = text.match(URL_REGEX) ?? [];
  for (const url of urls) {
    const host = hostnameFromUrl(url);
    if (host && isSnsHost(host)) return url;
  }

  const first = extractFirstUrl(text);
  if (!first) return null;
  const host = hostnameFromUrl(first);
  return host && isSnsHost(host) ? first : null;
}

/** 메시지에 인스타그램/페이스북 링크가 포함됐는지 판단. */
export function containsSnsLink(text: string): boolean {
  return extractSnsUrl(text) !== null;
}
