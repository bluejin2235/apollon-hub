import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  altReviewState,
  altReviewStorageKey,
  confirmAltReview,
  markAltReviewOnReplace,
  moveAltReviewSrc,
  parseAltReviewRecord
} from "../../lib/website/alt-review";

const OLD = { ko: "로비 벽면의 미디어 작품", en: "Media artwork on the lobby wall" };

describe("사진을 바꾸면 남은 설명은 지우지 않고 확인 필요로 표시", () => {
  it("국문·영문 문장을 그대로 두고 둘 다 확인 필요", () => {
    const rec = markAltReviewOnReplace(OLD, "works/a/key/new.jpg");
    assert.deepEqual(rec, { src: "works/a/key/new.jpg", ko: OLD.ko, en: OLD.en });
    assert.deepEqual(altReviewState(rec, "works/a/key/new.jpg", OLD), { ko: true, en: true });
  });

  it("빈칸·임시값은 표시하지 않는다", () => {
    assert.equal(markAltReviewOnReplace({ ko: "", en: " " }, "new.jpg"), null);
    assert.equal(markAltReviewOnReplace({ ko: "임시", en: "" }, "new.jpg"), null);
    const enOnly = markAltReviewOnReplace({ ko: "", en: "Lobby" }, "new.jpg");
    assert.deepEqual(enOnly, { src: "new.jpg", en: "Lobby" });
    assert.deepEqual(altReviewState(enOnly, "new.jpg", { ko: "", en: "Lobby" }), {
      ko: false,
      en: true
    });
  });

  it("새 사진 주소가 없으면 기록하지 않는다", () => {
    assert.equal(markAltReviewOnReplace(OLD, ""), null);
    assert.equal(markAltReviewOnReplace(OLD, null), null);
  });
});

describe("확인 필요 풀기", () => {
  const rec = markAltReviewOnReplace(OLD, "new.jpg");

  it("사람이 국문을 고치면 국문만 풀린다 (AI로 다시 써서 문장이 바뀌어도 같음)", () => {
    const state = altReviewState(rec, "new.jpg", { ko: "야외 광장의 미디어 파사드", en: OLD.en });
    assert.deepEqual(state, { ko: false, en: true });
  });

  it("둘 다 고치면 모두 풀린다", () => {
    const state = altReviewState(rec, "new.jpg", { ko: "야외 광장", en: "Outdoor plaza" });
    assert.deepEqual(state, { ko: false, en: false });
  });

  it("앞뒤 공백만 다르면 그대로인 것으로 본다", () => {
    const state = altReviewState(rec, "new.jpg", { ko: ` ${OLD.ko} `, en: OLD.en });
    assert.equal(state.ko, true);
  });

  it("「이 설명 그대로 쓰기」는 그 언어만 풀고, 둘 다 풀면 기록이 사라진다", () => {
    const afterKo = confirmAltReview(rec, "ko");
    assert.deepEqual(altReviewState(afterKo, "new.jpg", OLD), { ko: false, en: true });
    assert.equal(confirmAltReview(afterKo, "en"), null);
    assert.equal(confirmAltReview(null, "ko"), null);
  });

  it("사진 주소가 기록과 다르면 표시하지 않는다 (저장 안 하고 새로고침·사진 지움)", () => {
    assert.deepEqual(altReviewState(rec, "old.jpg", OLD), { ko: false, en: false });
    assert.deepEqual(altReviewState(rec, "", OLD), { ko: false, en: false });
    assert.deepEqual(altReviewState(null, "new.jpg", OLD), { ko: false, en: false });
  });
});

describe("같은 사진을 다시 자르면 확인 필요 상태를 이어 간다", () => {
  it("주소를 새 것으로 옮긴다", () => {
    const rec = markAltReviewOnReplace(OLD, "new.jpg");
    const moved = moveAltReviewSrc(rec, "new.jpg", "new-crop.jpg");
    assert.deepEqual(altReviewState(moved, "new-crop.jpg", OLD), { ko: true, en: true });
  });

  it("기록과 다른 사진을 자른 경우는 그대로 둔다", () => {
    const rec = markAltReviewOnReplace(OLD, "new.jpg");
    assert.equal(moveAltReviewSrc(rec, "other.jpg", "x.jpg"), rec);
    assert.equal(moveAltReviewSrc(null, "new.jpg", "x.jpg"), null);
  });
});

describe("브라우저에 저장한 기록 읽기", () => {
  it("모양이 맞으면 읽고, 아니면 null", () => {
    assert.deepEqual(parseAltReviewRecord(JSON.stringify({ src: "a.jpg", ko: "가" })), {
      src: "a.jpg",
      ko: "가"
    });
    assert.equal(parseAltReviewRecord(null), null);
    assert.equal(parseAltReviewRecord("{깨진"), null);
    assert.equal(parseAltReviewRecord(JSON.stringify({ src: "a.jpg" })), null);
    assert.equal(parseAltReviewRecord(JSON.stringify({ ko: "가" })), null);
  });

  it("워크·인사이트별로 칸을 나눈다", () => {
    assert.notEqual(altReviewStorageKey("work", "1"), altReviewStorageKey("insight", "1"));
  });
});
