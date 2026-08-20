/**
 * 실패 수집 v3 레이아웃 스크린샷
 * npx tsx scripts/verify-luna-failures-v3-screenshot.ts
 */
import { mkdirSync } from "fs";
import { join } from "path";
import { chromium } from "playwright";

async function main() {
  const outDir = join(process.cwd(), "docs", "audit", "highlight-screens");
  mkdirSync(outDir, { recursive: true });
  const src = join(process.cwd(), "docs", "luna-mockups", "luna-failures-v3.html");

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 2200 } });
  await page.goto(`file:///${src.replace(/\\/g, "/")}`);

  await page.screenshot({
    path: join(outDir, "luna-failures-v3-full.png"),
    fullPage: true
  });

  await page.setViewportSize({ width: 1200, height: 900 });
  await page.screenshot({
    path: join(outDir, "luna-failures-v3-top.png"),
    fullPage: false
  });
  await browser.close();
  console.log("✓ luna-failures-v3-full.png");
  console.log("✓ luna-failures-v3-top.png");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
