import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  countMentionTokens,
  customerTextOf,
  findInquiryFile,
  inquiryDownloadUrl,
  inquiryListView,
  inquirySummaryText,
  mentionPickerText,
  inquiryFileKey,
  inquiryStatus,
  inquiryTitle,
  isCompanyEmail,
  isLetsTalkInquiry,
  mentionSaveMessage,
  mentionedMemberNames,
  resolveNewMentions,
  type InquiryItem,
  type MentionMember
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

describe("countMentionTokens 경계", () => {
  it("메일 주소 안의 @이름 은 부른 것이 아니다", () => {
    assert.deepEqual(mentionedMemberNames("vendor@ann.example 로 보내 주세요", ["ann"]), []);
    assert.deepEqual(mentionedMemberNames("x@ann", ["ann"]), []);
  });

  it("앞은 처음 · 빈칸 · 문장부호, 뒤는 끝 · 빈칸 · 문장부호", () => {
    assert.equal(countMentionTokens("@ann", ["ann"]).get("ann"), 1);
    assert.equal(countMentionTokens("(@ann) 봐 주세요, @ann.", ["ann"]).get("ann"), 2);
    assert.equal(countMentionTokens("줄바꿈\n@ann\t확인", ["ann"]).get("ann"), 1);
    assert.deepEqual(mentionedMemberNames("@annie 확인", ["ann"]), []);
    assert.deepEqual(mentionedMemberNames("@김철수님 확인", ["김철수"]), []);
  });

  it("짧은 이름이 긴 이름 앞부분과 겹쳐도 긴 이름만", () => {
    assert.deepEqual(mentionedMemberNames("@김철수 확인", ["김철", "김철수"]), ["김철수"]);
  });
});

describe("resolveNewMentions", () => {
  const members: MentionMember[] = [
    { id: "u1", name: "김민수", team: "영업" },
    { id: "u2", name: "김민수", team: "디자인" },
    { id: "u3", name: "이영희", team: null }
  ];

  it("같은 이름 둘: 고른 id 만 부른다", () => {
    const result = resolveNewMentions({
      previous: "",
      next: "@김민수 확인해 주세요",
      members,
      mentionIds: ["u2"]
    });
    assert.deepEqual(result, { ids: ["u2"], ambiguous: [] });
  });

  it("고른 id 라도 메모에서 @이름 이 지워졌으면 부르지 않는다", () => {
    const result = resolveNewMentions({
      previous: "",
      next: "확인해 주세요",
      members,
      mentionIds: ["u3"]
    });
    assert.deepEqual(result, { ids: [], ambiguous: [] });
  });

  it("목록에 없는 id 는 버린다", () => {
    const result = resolveNewMentions({
      previous: "",
      next: "@이영희",
      members,
      mentionIds: ["ghost"]
    });
    assert.deepEqual(result, { ids: ["u3"], ambiguous: [] });
  });

  it("id 없는 옛 방식: 한 사람뿐이면 부르고, 같은 이름이 여럿이면 아무도 안 부른다", () => {
    const result = resolveNewMentions({
      previous: "",
      next: "@김민수 @이영희 봐 주세요",
      members
    });
    assert.deepEqual(result, { ids: ["u3"], ambiguous: ["김민수"] });
  });

  it("이전 메모에 이미 있던 @이름 은 다시 부르지 않는다", () => {
    const result = resolveNewMentions({
      previous: "@이영희 봐 주세요",
      next: "@이영희 봐 주세요. 추가 메모",
      members
    });
    assert.deepEqual(result, { ids: [], ambiguous: [] });
  });

  it("옛 방식도 경계를 지킨다", () => {
    const result = resolveNewMentions({
      previous: "",
      next: "lee@이영희.example",
      members
    });
    assert.deepEqual(result, { ids: [], ambiguous: [] });
  });
});

describe("isCompanyEmail", () => {
  it("회사 도메인만", () => {
    assert.equal(isCompanyEmail("a@apollonworks.com"), true);
    assert.equal(isCompanyEmail(" A@ApollonWorks.COM "), true);
    assert.equal(isCompanyEmail("a@gmail.com"), false);
    assert.equal(isCompanyEmail("a@apollonworks.com.evil.io"), false);
    assert.equal(isCompanyEmail("a@sub.apollonworks.com"), false);
    assert.equal(isCompanyEmail("a@b@apollonworks.com"), false);
    assert.equal(isCompanyEmail("@apollonworks.com"), false);
    assert.equal(isCompanyEmail(null), false);
  });
});

describe("mentionSaveMessage", () => {
  it("아무도 안 불렀으면 저장만", () => {
    assert.deepEqual(mentionSaveMessage({ deliveries: [], ambiguous: [] }), {
      message: "메모를 저장했습니다",
      tone: "ok"
    });
  });

  it("허브 알림 · 메일을 따로 알린다", () => {
    const { message, tone } = mentionSaveMessage({
      deliveries: [
        { id: "u1", name: "가", hub: "ok", email: "ok" },
        { id: "u2", name: "나", hub: "ok", email: "failed" },
        { id: "u3", name: "다", hub: "failed", email: "skipped", skipReason: "not_company" }
      ],
      ambiguous: ["김민수"]
    });
    assert.equal(tone, "warn");
    assert.match(message, /허브 알림 보냄: 가, 나/);
    assert.match(message, /허브 알림 실패: 다/);
    assert.match(message, /메일 보냄: 가/);
    assert.match(message, /메일 실패: 나/);
    assert.match(message, /메일은 안 보냄: 다/);
    assert.match(message, /@김민수/);
    assert.ok(!message.includes(String.fromCharCode(0x2014)));
  });
});

describe("첨부 id", () => {
  const items = [
    { id: "f1", name: "a.pdf", size: 1, url: "u1" },
    { id: "f2", name: "a.pdf", size: 2, url: "u2" }
  ];

  it("id 로 key 와 다시 찾기", () => {
    assert.equal(inquiryFileKey(items[1], 1), "id:f2");
    assert.equal(findInquiryFile(items, { id: "f2", name: "a.pdf", index: 0 })?.url, "u2");
  });

  it("id 가 없으면 이름 + 순서", () => {
    const old = [
      { name: "a.pdf", size: 1, url: "u1" },
      { name: "a.pdf", size: 2, url: "u2" }
    ];
    assert.equal(inquiryFileKey(old[1], 1), "name:a.pdf#1");
    assert.equal(findInquiryFile(old, { name: "a.pdf", index: 1 })?.url, "u2");
    assert.equal(findInquiryFile([old[1]], { name: "a.pdf", index: 1 })?.url, "u2");
  });
});

describe("inquiryDownloadUrl", () => {
  it("download= 가 있는 서명 주소는 그대로, 없으면 파일 이름으로 붙인다", () => {
    const signed = "https://x.supabase.co/storage/v1/object/sign/inq/a.pdf?token=abc%2Bdef&download=%EA%B2%AC%EC%A0%81.pdf";
    assert.equal(inquiryDownloadUrl(signed, "견적.pdf"), signed);
    const bare = inquiryDownloadUrl("https://x.supabase.co/storage/v1/object/sign/inq/a.pdf?token=abc", "견적.pdf");
    assert.equal(new URL(bare as string).searchParams.get("download"), "견적.pdf");
    assert.equal(new URL(bare as string).searchParams.get("token"), "abc");
  });

  it("http(s) 가 아니거나 주소가 아니면 null: 지금 탭에서 열지 않는다", () => {
    assert.equal(inquiryDownloadUrl("javascript:alert(1)", "a.pdf"), null);
    assert.equal(inquiryDownloadUrl("u1", "a.pdf"), null);
  });
});

describe("customerTextOf", () => {
  it("구역은 있는데 text 가 없으면 message", () => {
    const item = row({ sections: [{ title: "프로젝트", rows: [] }], message: "본문" });
    assert.equal(customerTextOf(item), "본문");
    assert.equal(customerTextOf({ ...item, text: "고객 글" }), "고객 글");
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

describe("문의 목록 · 요약 · 사람 목록 상태", () => {
  it("받기 전 · 실패는 「문의가 없습니다」가 아니라 불러오는 중 · 실패", () => {
    assert.equal(inquiryListView("loading", 0, false), "loading");
    // 검색 · 거르기를 바꿔 옛 목록이 남아 있어도 맞는 응답 전에는 불러오는 중
    assert.equal(inquiryListView("loading", 5, true), "loading");
    assert.equal(inquiryListView("error", 0, false), "error");
    assert.equal(inquiryListView("ready", 0, false), "empty");
    assert.equal(inquiryListView("ready", 0, true), "empty-search");
    assert.equal(inquiryListView("ready", 2, false), "items");
  });

  it("요약 칸은 받은 뒤에만 숫자, 그 전에는 0 이 아니라 상태 글", () => {
    assert.equal(inquirySummaryText("loading", undefined), "불러오는 중");
    assert.equal(inquirySummaryText("error", undefined), "불러오지 못함");
    assert.equal(inquirySummaryText("ready", 0), "0");
    assert.equal(inquirySummaryText("ready", 1234), "1,234");
  });

  it("사람 목록이 빈 채로 왔으면 「불러오는 중」에 머물지 않는다", () => {
    assert.equal(mentionPickerText("loading", 0, 0), "사람 목록을 불러오는 중…");
    assert.equal(mentionPickerText("ready", 0, 0), "부를 수 있는 사람이 없습니다");
    assert.equal(mentionPickerText("ready", 3, 0), "맞는 사람이 없습니다");
    assert.equal(mentionPickerText("ready", 3, 2), null);
    assert.equal(mentionPickerText("error", 0, 0), "사람 목록을 불러오지 못했습니다");
  });
});
