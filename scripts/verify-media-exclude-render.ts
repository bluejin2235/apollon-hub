/**
 * Render 폴더·렌더 레이어는 KEEP(KV)이어도 제외.
 *   npx tsx scripts/verify-media-exclude-render.ts
 */
import assert from "node:assert/strict";
import { mediaIndexRulesVersion } from "../lib/luna/media-index-rules";
import { classifyMediaFile } from "../lib/luna/media-scan";

const SIZE = 200 * 1024;

const kvRender =
  "T:\\01 사업개발\\2026\\260108 해운대스퀘어 공공부지사업\\05 Design\\260224 KV, 영상시뮬레이션\\Render\\#02_AI_Normal.png";
const kvLayerNoRenderFolder =
  "T:\\01 사업개발\\2026\\260108 해운대스퀘어 공공부지사업\\05 Design\\260224 KV, 영상시뮬레이션\\#02_AI_Normal.png";
const kvBeauty =
  "T:\\01 사업개발\\2026\\260108 해운대스퀘어 공공부지사업\\05 Design\\260224 KV, 영상시뮬레이션\\해운대_쇼_KV_#06_01.png";

const renderFolder = classifyMediaFile(kvRender, SIZE);
assert.equal(renderFolder.ok, false, "KV+Render 폴더는 하드 제외");
if (!renderFolder.ok) {
  assert.equal(renderFolder.reason, "exclude:render");
}

const layer = classifyMediaFile(kvLayerNoRenderFolder, SIZE);
assert.equal(layer.ok, false, "파일명 _Normal 은 하드 제외");
if (!layer.ok) {
  assert.equal(layer.reason, "exclude:render_layer");
}

const beauty = classifyMediaFile(kvBeauty, SIZE);
assert.equal(beauty.ok, true, "KV 본 이미지는 남김");

const gongganAlbedo =
  "T:\\01 사업개발\\2025\\250616 KT광화문 West빌딩 리모델링\\04 Design\\250618 KV\\공간렌더\\아트_AI_Albedo.png";
const gonggan = classifyMediaFile(gongganAlbedo, SIZE);
assert.equal(gonggan.ok, false, "KV KEEP + 공간렌더 _Albedo 는 하드 제외");
if (!gonggan.ok) {
  assert.equal(gonggan.reason, "exclude:render_layer");
}

const ver = mediaIndexRulesVersion();
assert.match(ver, /^r2-[0-9a-f]{8}$/);

console.log("media exclude render ok", ver);
