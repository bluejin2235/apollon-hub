import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasExistingAlt,
  isSameAltTarget,
  mergeAiAlt
} from "../../lib/website/alt-suggest-apply";

const AI = { ko: "건물 외벽을 덮은 미디어 파사드 야경", en: "Night view of a media facade covering the building exterior" };

describe("mergeAiAlt — 언어별 보존", () => {
  it("국문 빈칸 + 사람이 쓴 영문: 국문만 채우고 영문은 그대로", () => {
    const before = { ko: "", en: "Lobby with a projected art wall" };
    assert.deepEqual(mergeAiAlt({ before, now: before, result: AI, force: false }), {
      ko: AI.ko,
      en: "Lobby with a projected art wall"
    });
  });

  it("국문 임시값 + 영문 임시값: 둘 다 채움", () => {
    const before = { ko: "임시", en: "image" };
    assert.deepEqual(mergeAiAlt({ before, now: before, result: AI, force: false }), AI);
  });

  it("국문 사람 문장 + 영문 빈칸: 영문만 채움", () => {
    const before = { ko: "광장 바닥 프로젝션 전경", en: "" };
    assert.deepEqual(mergeAiAlt({ before, now: before, result: AI, force: false }), {
      ko: "광장 바닥 프로젝션 전경",
      en: AI.en
    });
  });

  it("두 언어 모두 사람 문장이면 자동 채우기는 바꿀 것 없음", () => {
    const before = { ko: "광장 바닥 프로젝션 전경", en: "Floor projection in the plaza" };
    assert.equal(mergeAiAlt({ before, now: before, result: AI, force: false }), null);
  });

  it("확인 창을 통과한 다시 쓰기는 두 언어 모두 교체", () => {
    const before = { ko: "광장 바닥 프로젝션 전경", en: "Floor projection in the plaza" };
    assert.deepEqual(mergeAiAlt({ before, now: before, result: AI, force: true }), AI);
  });

  it("요청 중 사람이 고치면 적용하지 않음", () => {
    const before = { ko: "", en: "" };
    assert.equal(
      mergeAiAlt({ before, now: { ko: "", en: "typed meanwhile" }, result: AI, force: false }),
      null
    );
    assert.equal(
      mergeAiAlt({ before, now: { ko: "직접 씀", en: "" }, result: AI, force: true }),
      null
    );
  });
});

describe("hasExistingAlt — 다시 쓰기 확인 창", () => {
  it("어느 언어든 사람 문장이 있으면 묻는다", () => {
    assert.equal(hasExistingAlt({ ko: "", en: "Lobby with a projected art wall" }), true);
    assert.equal(hasExistingAlt({ ko: "광장 전경", en: "" }), true);
  });

  it("둘 다 빈칸·임시값이면 묻지 않는다", () => {
    assert.equal(hasExistingAlt({ ko: "", en: "" }), false);
    assert.equal(hasExistingAlt({ ko: "임시", en: "IMG_1234.jpg" }), false);
  });
});

describe("isSameAltTarget — 대표 이미지 경합", () => {
  const started = { contentId: "w1", src: "https://x/a.jpg", seq: 1 };

  it("같은 콘텐츠 · 같은 이미지 · 같은 순번이면 적용", () => {
    assert.equal(isSameAltTarget(started, { ...started }), true);
    assert.equal(isSameAltTarget(started, { ...started, src: "https://x/a.jpg/" }), true);
  });

  it("이미지를 바꾸거나 지우면 버림", () => {
    assert.equal(isSameAltTarget(started, { ...started, src: "https://x/b.jpg" }), false);
    assert.equal(isSameAltTarget(started, { ...started, src: "" }), false);
  });

  it("새 요청이 나가면 이전 결과는 버림", () => {
    assert.equal(isSameAltTarget(started, { ...started, seq: 2 }), false);
  });

  it("다른 콘텐츠로 옮기면 버림", () => {
    assert.equal(isSameAltTarget(started, { ...started, contentId: "w2" }), false);
  });
});
