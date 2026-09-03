import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const OUT = resolve(process.cwd(), "scripts/out-type-compare");
mkdirSync(OUT, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const rows: unknown[] = [];
  for (const w of [1440, 1600, 1920]) {
    const page = await browser.newPage({ viewport: { width: w, height: 1000 } });
    await page.goto("http://localhost:3100/works/star-avenue-renewal-lotte-duty-free", {
      waitUntil: "networkidle",
      timeout: 90_000
    });
    const m = await page.evaluate(() => {
      const main = document.querySelector(".shell__main");
      const heading = document.querySelector(".content__heading");
      const body = document.querySelector(".content__body");
      const p = body?.querySelector("p") || body;
      const pcs = p ? getComputedStyle(p) : null;
      return {
        mainW: main ? Math.round(main.getBoundingClientRect().width * 10) / 10 : null,
        headingW: heading ? Math.round(heading.getBoundingClientRect().width * 10) / 10 : null,
        bodyW: body ? Math.round(body.getBoundingClientRect().width * 10) / 10 : null,
        pW: p ? Math.round(p.getBoundingClientRect().width * 10) / 10 : null,
        pH: p ? Math.round(p.getBoundingClientRect().height * 10) / 10 : null,
        fontSize: pcs?.fontSize,
        lineHeight: pcs?.lineHeight,
        approxLines:
          p && pcs
            ? Math.max(1, Math.round(p.getBoundingClientRect().height / (parseFloat(pcs.lineHeight) || 30)))
            : null
      };
    });
    rows.push({ viewport: w, ...m });
    console.log(JSON.stringify({ viewport: w, ...m }));
    await page.screenshot({
      path: resolve(OUT, `public-lead-${w}.png`),
      fullPage: false
    });
    await page.close();
  }
  writeFileSync(resolve(OUT, "public-lead-widths.json"), JSON.stringify(rows, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
