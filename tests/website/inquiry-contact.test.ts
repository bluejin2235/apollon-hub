import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  inquiryStatus,
  inquiryTitle,
  isLetsTalkInquiry,
  mentionedMemberNames,
  type InquiryItem
} from "../../lib/website/contact";

function row(extra: Partial<InquiryItem> = {}): InquiryItem {
  return {
    id: "a1",
    kind: "project",
    name: "홍길동",
    company: null,
    email: "a@example.com",
    phone: null,
    budget: null,
    timeline: null,
    message: null,
    locale: "ko",
    is_read: false,
    replied_at: null,
    memo: null,
    created_at: "2026-11-18T00:00:00Z",
    ...extra
  };
}

describe("mentionedMemberNames", () => {
  const names = ["김철", "김철수", "이영희"];

  it("같은 자리에서는 가장 긴 이름", () => {
    assert.deepEqual(mentionedMemberNames("@김철수 봐 주세요", names), ["김철수"]);
  });

  it("여러 사람 · 중복 제거", () => {
    assert.deepEqual(
      mentionedMemberNames("@이영희 @김철 그리고 @이영희", names).sort(),
      ["김철", "이영희"]
    );
  });

  it("목록에 없는 이름 · 메일 주소는 무시", () => {
    assert.deepEqual(mentionedMemberNames("a@example.com @박모 확인", names), []);
  });
});

describe("inquiryTitle", () => {
  it("홈페이지 제목을 먼저 쓴다", () => {
    assert.equal(
      inquiryTitle(row({ title: "예시주식회사, 성수동 · 미디어 설치", message: "접수번호: LT-1" })),
      "예시주식회사, 성수동 · 미디어 설치"
    );
  });

  it("제목이 없으면 내용 앞부분, 그것도 없으면 이름", () => {
    assert.equal(inquiryTitle(row({ message: "전시 문의드립니다" })), "전시 문의드립니다");
    assert.equal(inquiryTitle(row()), "홍길동 님 문의");
  });
});

describe("isLetsTalkInquiry · inquiryStatus", () => {
  it("접수번호나 구역이 있으면 Let's Talk", () => {
    assert.equal(isLetsTalkInquiry(row()), false);
    assert.equal(isLetsTalkInquiry(row({ receipt_no: "LT-1" })), true);
    assert.equal(isLetsTalkInquiry(row({ sections: [{ title: "프로젝트", rows: [] }] })), true);
  });

  it("상태", () => {
    assert.equal(inquiryStatus(row()), "unread");
    assert.equal(inquiryStatus(row({ is_read: true })), "pending");
    assert.equal(inquiryStatus(row({ is_read: true, replied_at: "2026-11-18" })), "done");
  });
});
