import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isAllowedWebsiteImageUrl,
  isRedirectStatus,
  WEBSITE_STORAGE_HOST
} from "../../lib/website/alt-suggest-url";
import {
  exceedsAltImageByteLimit,
  isImageContentType,
  MAX_ALT_IMAGE_BYTES
} from "../../lib/website/alt-suggest-fetch-limits";
import { shouldApplyAiAlt } from "../../lib/website/alt-suggest-apply";

describe("isAllowedWebsiteImageUrl", () => {
  const ok = `https://${WEBSITE_STORAGE_HOST}/storage/v1/object/public/works/slug/key/a.jpg`;

  it("우리 버킷 공개 주소는 통과", () => {
    assert.equal(isAllowedWebsiteImageUrl(ok), true);
    assert.equal(
      isAllowedWebsiteImageUrl(
        `https://${WEBSITE_STORAGE_HOST}/storage/v1/object/public/insights/x/y.png`
      ),
      true
    );
    assert.equal(
      isAllowedWebsiteImageUrl(
        `https://${WEBSITE_STORAGE_HOST}/storage/v1/object/public/site/logo.webp`
      ),
      true
    );
  });

  it("다른 supabase·localhost·http·apollonworks 는 막힘", () => {
    assert.equal(
      isAllowedWebsiteImageUrl(
        "https://otherproject.supabase.co/storage/v1/object/public/works/a.jpg"
      ),
      false
    );
    assert.equal(
      isAllowedWebsiteImageUrl("http://localhost:3100/works/a.jpg"),
      false
    );
    assert.equal(
      isAllowedWebsiteImageUrl(
        `http://${WEBSITE_STORAGE_HOST}/storage/v1/object/public/works/a.jpg`
      ),
      false
    );
    assert.equal(
      isAllowedWebsiteImageUrl("https://www.apollonworks.com/works/a.jpg"),
      false
    );
    assert.equal(
      isAllowedWebsiteImageUrl(
        `https://${WEBSITE_STORAGE_HOST}/storage/v1/object/public/private/a.jpg`
      ),
      false
    );
  });
});

describe("redirect · content-type · size helpers", () => {
  it("3xx 는 리다이렉트로 본다", () => {
    assert.equal(isRedirectStatus(301), true);
    assert.equal(isRedirectStatus(302), true);
    assert.equal(isRedirectStatus(307), true);
    assert.equal(isRedirectStatus(200), false);
    assert.equal(isRedirectStatus(404), false);
  });

  it("image/* 만 허용", () => {
    assert.equal(isImageContentType("image/jpeg"), true);
    assert.equal(isImageContentType("image/png; charset=binary"), true);
    assert.equal(isImageContentType("application/octet-stream"), false);
    assert.equal(isImageContentType(null), false);
  });

  it("10MB 넘으면 Content-Length 로 거절", () => {
    assert.equal(MAX_ALT_IMAGE_BYTES, 10 * 1024 * 1024);
    assert.equal(exceedsAltImageByteLimit(String(MAX_ALT_IMAGE_BYTES + 1)), true);
    assert.equal(exceedsAltImageByteLimit(String(MAX_ALT_IMAGE_BYTES)), false);
    assert.equal(exceedsAltImageByteLimit(null), false);
  });
});

describe("shouldApplyAiAlt", () => {
  it("요청 중 칸이 안 바뀌면 적용", () => {
    assert.equal(
      shouldApplyAiAlt({
        koBefore: "",
        enBefore: "",
        koNow: "",
        enNow: ""
      }),
      true
    );
  });

  it("요청 중 사람이 고치면 적용하지 않음", () => {
    assert.equal(
      shouldApplyAiAlt({
        koBefore: "",
        enBefore: "",
        koNow: "사람이 직접 쓴 문장입니다",
        enNow: ""
      }),
      false
    );
    assert.equal(
      shouldApplyAiAlt({
        koBefore: "옛 문장",
        enBefore: "old",
        koNow: "옛 문장",
        enNow: "changed"
      }),
      false
    );
  });
});

describe("canAccessWebsiteAdmin for alt-suggest", () => {
  it("역할 없거나 모르는 역할은 막고, 홈페이지 허용 역할은 통과", async () => {
    const { canAccessWebsiteAdmin } = await import("../../lib/auth/website-tester");
    assert.equal(canAccessWebsiteAdmin(""), false);
    assert.equal(canAccessWebsiteAdmin(null), false);
    assert.equal(canAccessWebsiteAdmin("손님"), false);
    assert.equal(canAccessWebsiteAdmin("멤버"), true);
    assert.equal(canAccessWebsiteAdmin("중간관리자"), true);
    assert.equal(canAccessWebsiteAdmin("슈퍼관리자"), true);
    assert.equal(canAccessWebsiteAdmin("홈페이지테스터"), true);
  });
});
