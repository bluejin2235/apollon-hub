/**
 * 공개 워크/인사이트 본문 메트릭 실측
 * npx tsx scripts/measure-public-body.ts
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SITE = process.env.SITE_URL ?? "http://localhost:3100";
const OUT = resolve(process.cwd(), "scripts/out-type-compare");

async function measure(page: import("playwright").Page, url: string, selector: string) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(1200);
  const el = page.locator(selector).first();
  const count = await el.count();
  if (!count) {
    return { url, selector, found: false as const };
  }
  await el.scrollIntoViewIfNeeded();
  const data = await el.evaluate((node) => {
    const cs = getComputedStyle(node);
    const parent = node.parentElement;
    const pcs = parent ? getComputedStyle(parent) : null;
    const box = node.getBoundingClientRect();
    const pbox = parent?.getBoundingClientRect();
    let pPlusP: string | null = null;
    if (parent) {
      const ps = parent.querySelectorAll("p");
      if (ps.length >= 2) {
        pPlusP = getComputedStyle(ps[1]!).marginTop;
      }
    }
    return {
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing,
      fontWeight: cs.fontWeight,
      fontFamily: cs.fontFamily,
      pWidth: box.width,
      parentWidth: pbox?.width ?? null,
      parentClass: parent?.className ?? null,
      pPlusP_marginTop: pPlusP,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      rootFontSize: getComputedStyle(document.documentElement).fontSize,
    };
  });
  return { url, selector, found: true as const, ...data };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  // desktop-ish and the user's likely viewport
  const viewports = [
    { name: "desktop1400", width: 1400, height: 900 },
    { name: "desktop1920", width: 1920, height: 1080 },
    { name: "narrow900", width: 900, height: 900 },
  ];

  const results: unknown[] = [];

  for (const vp of viewports) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });

    // insight: try live slug from list
    await page.goto(`${SITE}/insight`, { waitUntil: "networkidle", timeout: 120_000 });
    const insightHref = await page.locator('a[href*="/insight/"]').first().getAttribute("href");
    const insightUrl = insightHref
      ? insightHref.startsWith("http")
        ? insightHref
        : `${SITE}${insightHref}`
      : `${SITE}/insight/interview-jihyun-kim`;

    await page.goto(`${SITE}/works`, { waitUntil: "networkidle", timeout: 120_000 });
    const workHref = await page.locator('a[href*="/works/"]').first().getAttribute("href");
    const workUrl = workHref
      ? workHref.startsWith("http")
        ? workHref
        : `${SITE}${workHref}`
      : null;

    const insight = await measure(page, insightUrl, ".block-wysiwyg p");
    // work lead / body text
    let workBody = workUrl
      ? await measure(page, workUrl, ".content__body, .content__heading .content__body, .block-text-only, .block-wysiwyg p")
      : { found: false as const, url: null };
    // also try content body specifically
    let workContentBody = workUrl
      ? await measure(page, workUrl, ".content__body")
      : { found: false as const, url: null };

    results.push({ viewport: vp, insight, workBody, workContentBody });
    await page.close();
  }

  await browser.close();
  writeFileSync(resolve(OUT, "public-measure.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
