/**
 * 인사이트 공개 화면 — 분류 영문 · 날짜 · 글자 크기
 * npx tsx scripts/verify-insight-public-labels.ts
 */
import fs from "node:fs";
import path from "node:path";

import { chromium, type ConsoleMessage } from "playwright";

const SITE = "http://localhost:3100";
const HUB = "http://localhost:3000";
const DETAIL = `${SITE}/insight/insight-1788403880038`;
const LIST = `${SITE}/insight`;
const OUT = path.join("tmp", "insight-public-labels");

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  const report: string[] = [];

  await page.goto(LIST, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator(".insight-card").first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);

  const firstCard = page.locator(".insight-card").first();
  await firstCard.hover();
  await page.waitForTimeout(300);

  const categoryTexts = await page.locator(".insight-card__category").allTextContents();
  const dateTexts = await page.locator(".insight-card__date").allTextContents();
  const filterTexts = await page
    .locator("button")
    .filter({ hasText: /News|Interview|Culture|Lab|Behind|All/i })
    .allTextContents();
  report.push(`card categories sample=${JSON.stringify(categoryTexts.slice(0, 6))}`);
  report.push(`card dates sample=${JSON.stringify(dateTexts.slice(0, 6))}`);
  report.push(`filters=${JSON.stringify(filterTexts.slice(0, 8))}`);

  const koreanCats = categoryTexts.filter((t) => /뉴스|인터뷰|컬처|랩|비하인드/.test(t));
  report.push(`korean on cards=${koreanCats.length ? koreanCats.join("|") : "none"}`);

  const sizes = await firstCard.evaluate((el) => {
    const title = el.querySelector(".insight-card__title");
    const cat = el.querySelector(".insight-card__category");
    const date = el.querySelector(".insight-card__date");
    return {
      title: title ? window.getComputedStyle(title).fontSize : null,
      category: cat ? window.getComputedStyle(cat).fontSize : null,
      date: date ? window.getComputedStyle(date).fontSize : null,
    };
  });
  report.push(`fontSize title=${sizes.title} category=${sizes.category} date=${sizes.date}`);

  await page.screenshot({ path: path.join(OUT, "01-list.png"), fullPage: true });

  await page.goto(DETAIL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator(".insight-detail__title").waitFor({ timeout: 60_000 });
  const detailDate = await page.locator(".insight-detail__date").textContent().catch(() => null);
  const detailSubtitle = await page.locator(".insight-detail__subtitle").count();
  report.push(`detail date=${detailDate} subtitleCount=${detailSubtitle}`);
  await page.screenshot({ path: path.join(OUT, "02-detail.png"), fullPage: true });

  let adminKo = "skipped";
  try {
    await page.goto(`${HUB}/website/insights`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    const body = await page.locator("body").innerText();
    if (/로그인|Login|Sign in/i.test(body) && !/뉴스|인터뷰/.test(body)) {
      adminKo = "login-wall";
    } else {
      adminKo = /뉴스|인터뷰|컬처|비하인드/.test(body) ? "korean-present" : "no-korean-found";
    }
    await page.screenshot({ path: path.join(OUT, "03-admin.png"), fullPage: true });
  } catch (err) {
    adminKo = err instanceof Error ? err.message.slice(0, 80) : "hub-unreachable";
  }
  report.push(`admin=${adminKo}`);

  const filtered = errors.filter(
    (line) =>
      !/favicon|Download the React DevTools|hydrated but some attributes|hydration-mismatch/i.test(
        line,
      ),
  );
  report.push(`console errors=${filtered.length}${filtered.length ? ` ${filtered.join(" | ")}` : ""}`);
  fs.writeFileSync(path.join(OUT, "report.txt"), report.join("\n"));
  console.log(report.join("\n"));

  if (
    koreanCats.length > 0 ||
    sizes.title !== "25px" ||
    sizes.category !== "15px" ||
    !detailDate ||
    filtered.length > 0
  ) {
    throw new Error("VERIFY_FAIL\n" + report.join("\n"));
  }
  console.log("VERIFY_OK");
  await browser.close();
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
