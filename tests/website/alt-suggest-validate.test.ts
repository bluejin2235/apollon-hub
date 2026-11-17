import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateAltSuggestion } from "../../lib/website/alt-suggest-validate";

describe("validateAltSuggestion", () => {
  it("정상 국·영 문장은 통과", () => {
    const ok = validateAltSuggestion(
      "건물 외벽 미디어파사드에 푸른 빛 패턴이 흐르는 야간 전경",
      "Blue light patterns flowing across a media facade on a building exterior at night"
    );
    assert.ok(ok);
    assert.equal(ok?.ko.includes("미디어파사드"), true);
  });

  it("국문이 너무 짧으면 거절", () => {
    assert.equal(
      validateAltSuggestion("짧은 문장입니다", "A sufficiently long English sentence for the alt text field here"),
      null
    );
  });

  it("영문이 너무 짧으면 거절", () => {
    assert.equal(
      validateAltSuggestion(
        "건물 외벽 미디어파사드에 푸른 빛 패턴이 흐르는 야간 전경",
        "Too short English"
      ),
      null
    );
  });

  it("금지어·시작어·마침표를 거절", () => {
    assert.equal(
      validateAltSuggestion(
        "이미지로 본 건물 외벽 미디어파사드 야간 전경입니다.",
        "Blue light patterns flowing across a media facade on a building exterior at night."
      ),
      null
    );
    assert.equal(
      validateAltSuggestion(
        "로비 최고 미디어월이 방문객을 맞이하는 실내 장면",
        "The lobby media wall greets visitors with soft ambient light patterns nearby"
      ),
      null
    );
    assert.equal(
      validateAltSuggestion(
        "아폴론 스튜디오에서 찍은 미디어파사드 외벽 전경 사진",
        "Media facade exterior photographed during an evening walk through the plaza area"
      ),
      null
    );
  });

  it("영문에 한글이 있으면 거절", () => {
    assert.equal(
      validateAltSuggestion(
        "건물 외벽 미디어파사드에 푸른 빛 패턴이 흐르는 야간 전경",
        "Blue light patterns on a media facade 전경 at night across the plaza"
      ),
      null
    );
  });

  it("임시·숫자만은 거절", () => {
    assert.equal(validateAltSuggestion("00", "111111111111111111111111111111111111111111"), null);
    assert.equal(
      validateAltSuggestion("test", "A sufficiently long English sentence for the alt text field here"),
      null
    );
  });
});
