/**
 * 실패 수집 UI 검증 — HTML 렌더 + 스크린샷
 * npx tsx scripts/verify-luna-failures-screenshot.ts
 */
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { chromium } from "playwright";

const OUT = join(process.cwd(), "docs/audit/highlight-screens");
mkdirSync(OUT, { recursive: true });

const failuresHtml = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"/>
<style>
  body{font-family:system-ui,sans-serif;background:#f5f6f8;margin:0;padding:24px;color:#1a1d21}
  .nav{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
  .nav b{background:#534AB7;color:#fff;padding:8px 12px;border-radius:8px;font-size:13px}
  .nav span{border:1px solid #e7e8ec;background:#fff;padding:8px 12px;border-radius:8px;font-size:13px;color:#444}
  .sum{font-size:13px;margin-bottom:16px}
  .cluster{border:1px solid #e7e8ec;background:#fafbfc;border-radius:8px;padding:10px 12px;margin-bottom:8px;font-size:13px}
  .card{border:1px solid #e7e8ec;background:#fff;border-radius:12px;padding:14px 16px;margin-bottom:10px}
  .badges{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
  .badge{font-size:10.5px;padding:2px 8px;border-radius:10px;border:1px solid #e7e8ec;background:#f5f6f8;color:#6b6f76}
  .badge.red{border-color:#fecaca;background:#fef2f2;color:#b91c1c}
  .q{font-weight:700;font-size:13.5px;margin:0 0 6px}
  .a{font-size:13px;color:#444;margin:0}
  .note{font-size:12px;color:#b45309;font-style:italic;margin-top:6px}
  .btns{display:flex;gap:8px;margin-top:10px}
  button{font-size:12px;padding:6px 12px;border-radius:8px;border:1px solid #e7e8ec;background:#fff}
  button.primary{border-color:#2563eb;background:#eff6ff;color:#2563eb;font-weight:600}
  .improve{margin-top:10px;border:1px solid #e7e8ec;background:#fafbfc;border-radius:8px;padding:12px}
  textarea{width:100%;min-height:72px;border:1px solid #e7e8ec;border-radius:6px;padding:8px;font-size:13px}
</style></head><body>
  <div class="nav">
    <span>대시보드</span><span>지식</span><span>대화</span><span>자습</span><span>지식후보</span>
    <b>실패 수집</b><span>두뇌</span>
  </div>
  <p class="sum">확인할 것 <strong>24</strong> · 개선한 것 <strong>11</strong> · 스킵한 것 <strong>8</strong></p>
  <p style="font-size:12px;font-weight:600;color:#6b6f76;margin-bottom:8px">묶어 보기</p>
  <div class="cluster">「병가·휴직 관련…」 관련 4번 · 2명</div>
  <div class="card">
    <div class="badges"><span class="badge">👎</span><span class="badge red">의도 3</span><span class="badge red">자신감 2</span></div>
    <p class="q">병가 규정이 어떻게 되나요?</p>
    <p class="a">관련 자료를 찾지 못했습니다. 인사팀에 확인이 필요합니다.</p>
    <p class="note">무엇을 묻는지는 알겠는데 우리 자료에서 근거를 찾지 못했어요.</p>
    <div class="btns"><button class="primary">개선하기</button><button>스킵하기</button></div>
    <div class="improve">
      <p style="font-size:12px;font-weight:600;margin:0 0 8px">이렇게 했어야 해요</p>
      <textarea placeholder="새 사실, 위키 누락, 답변 방식…"></textarea>
      <div class="btns" style="margin-top:8px"><button class="primary">남기기</button><button>취소</button></div>
    </div>
  </div>
</body></html>`;

const scoresHtml = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"/>
<style>
  body{font-family:system-ui,sans-serif;background:#fff;padding:32px}
  .bubble{max-width:520px;background:#f5f6f8;border-radius:16px;padding:14px 16px;font-size:14px;line-height:1.55}
  .row{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px;align-items:center}
  .badge{font-size:10.5px;padding:2px 8px;border-radius:10px;border:1px solid #e7e8ec;background:#f5f6f8;color:#6b6f76}
  .badge.red{border-color:#fecaca;background:#fef2f2;color:#b91c1c}
  .note{width:100%;font-size:11px;color:#b45309;font-style:italic}
</style></head><body>
  <div class="bubble">
    KCC 인허가 절차는 위키에 정리되어 있습니다. 신청 → 서류 → 현장 확인 순입니다.
    <div class="row">
      <span class="badge">위키 1건</span>
      <span class="badge">기억 5건</span>
      <span class="badge">의도 9</span>
      <span class="badge">자신감 9</span>
    </div>
  </div>
  <div style="height:24px"></div>
  <div class="bubble">
    병가 규정 관련 자료를 찾지 못했습니다.
    <div class="row">
      <span class="badge">의도 8</span>
      <span class="badge red">자신감 3</span>
      <span class="note">방향은 잡았지만 사실 확인이 필요해요.</span>
    </div>
  </div>
</body></html>`;

async function shot(name: string, html: string) {
  const htmlPath = join(OUT, `${name}.html`);
  writeFileSync(htmlPath, html, "utf8");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  await browser.close();
  console.log(`✓ ${name}.png`);
}

async function main() {
  await shot("luna-failures-page", failuresHtml);
  await shot("luna-answer-scores", scoresHtml);
  console.log("\n검증 체크리스트 (코드 연결):");
  console.log("1. 👎 → recordLunaFailure(thumbs_down)");
  console.log("2. 찾지 못했다 → recordAutoFailuresFromAnswer(not_found)");
  console.log("3. 답변 하단 의도/자신감 배지 → LunaMessage SourceBadgeRow");
  console.log("4. 개선하기 → PATCH /api/luna/failures improve");
  console.log("5. 스킵하기 → PATCH /api/luna/failures skip");
  console.log("6. 묶어 보기 → clusterFailures()");
  console.log("7. 대화>싫어요 탭 제거 → settings-nav talk subs");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
