import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasHangulInText,
  isPlaceholderAlt,
  isShortAlt,
  isWeakEnglishAlt
} from "../../lib/website/placeholder-alt";

describe("isPlaceholderAlt", () => {
  it("빈칸·공백만이면 참", () => {
    assert.equal(isPlaceholderAlt(null), true);
    assert.equal(isPlaceholderAlt(undefined), true);
    assert.equal(isPlaceholderAlt(""), true);
    assert.equal(isPlaceholderAlt("   "), true);
  });

  it("숫자·기호만이면 참", () => {
    assert.equal(isPlaceholderAlt("00"), true);
    assert.equal(isPlaceholderAlt("111"), true);
    assert.equal(isPlaceholderAlt("-"), true);
    assert.equal(isPlaceholderAlt("..."), true);
    assert.equal(isPlaceholderAlt("1-2"), true);
  });

  it("한 글자는 거짓 (「꽃」「숲」 같은 정상 설명) — 경고 대상", () => {
    assert.equal(isPlaceholderAlt("꽃"), false);
    assert.equal(isPlaceholderAlt("숲"), false);
    assert.equal(isShortAlt("꽃"), true);
    assert.equal(isShortAlt("숲"), true);
    assert.equal(isShortAlt("빛의 정원"), false);
    // 한 글자라도 숫자·기호면 여전히 임시값 (경고가 아니라 차단)
    assert.equal(isPlaceholderAlt("1"), true);
    assert.equal(isShortAlt("1"), false);
  });

  it("금지 낱말과 같으면 참 (대소문자·공백 무시)", () => {
    assert.equal(isPlaceholderAlt("임시"), true);
    assert.equal(isPlaceholderAlt("이미지"), true);
    assert.equal(isPlaceholderAlt("사진"), true);
    assert.equal(isPlaceholderAlt("그림"), true);
    assert.equal(isPlaceholderAlt("대체텍스트"), true);
    assert.equal(isPlaceholderAlt("대체 텍스트"), true);
    assert.equal(isPlaceholderAlt("없음"), true);
    assert.equal(isPlaceholderAlt("미정"), true);
    assert.equal(isPlaceholderAlt("test"), true);
    assert.equal(isPlaceholderAlt("TEST"), true);
    assert.equal(isPlaceholderAlt("테스트"), true);
    assert.equal(isPlaceholderAlt("tbd"), true);
    assert.equal(isPlaceholderAlt("todo"), true);
    assert.equal(isPlaceholderAlt("alt"), true);
    assert.equal(isPlaceholderAlt("image"), true);
    assert.equal(isPlaceholderAlt("img"), true);
    assert.equal(isPlaceholderAlt("photo"), true);
    assert.equal(isPlaceholderAlt("picture"), true);
    assert.equal(isPlaceholderAlt("placeholder"), true);
    assert.equal(isPlaceholderAlt("untitled"), true);
  });

  it("파일 이름 꼴이면 참", () => {
    assert.equal(isPlaceholderAlt("IMG_1234.jpg"), true);
    assert.equal(isPlaceholderAlt("IMG_1234"), true);
    assert.equal(isPlaceholderAlt("DSC01234"), true);
    assert.equal(isPlaceholderAlt("KakaoTalk_20241117"), true);
    assert.equal(isPlaceholderAlt("스크린샷 2024-11-17"), true);
    assert.equal(isPlaceholderAlt("lobby.webp"), true);
  });

  it("짧은 정상 이름은 거짓", () => {
    assert.equal(isPlaceholderAlt("삼성"), false);
    assert.equal(isPlaceholderAlt("현대"), false);
    assert.equal(isPlaceholderAlt("롯데"), false);
    assert.equal(isPlaceholderAlt("로비"), false);
    assert.equal(isPlaceholderAlt("IBM"), false);
    assert.equal(isPlaceholderAlt("SK"), false);
    assert.equal(isPlaceholderAlt("LG전자"), false);
  });

  it("단어가 들어 있기만 한 설명문은 거짓", () => {
    assert.equal(isPlaceholderAlt("테스트하는 팀원들"), false);
    assert.equal(isPlaceholderAlt("임시로 쓴 설명이 아닙니다"), false);
    assert.equal(isPlaceholderAlt("image of the lobby"), false);
  });

  it("실제 문장은 거짓", () => {
    assert.equal(isPlaceholderAlt("트렌디유스 타운 미디어 건축 개념 설계 전경"), false);
    assert.equal(
      isPlaceholderAlt("미디어 아키텍처 디자인이란 무엇인지 설명하는 대표 이미지"),
      false
    );
    assert.equal(
      isPlaceholderAlt("Encountering the Art 전시 공간 전경, Asia Media Center"),
      false
    );
  });
});

describe("isWeakEnglishAlt", () => {
  it("임시 영문·빈칸·한 글자는 참", () => {
    assert.equal(isWeakEnglishAlt("a"), true);
    assert.equal(isWeakEnglishAlt("00"), true);
    assert.equal(isWeakEnglishAlt(""), true);
    assert.equal(isWeakEnglishAlt("test"), true);
  });

  it("영문 칸에 한글이 있으면 참", () => {
    assert.equal(isWeakEnglishAlt("전경 사진"), true);
    assert.equal(hasHangulInText("Lobby view 전경"), true);
    assert.equal(isWeakEnglishAlt("Lobby view 전경"), true);
  });

  it("정상 영문은 거짓", () => {
    assert.equal(
      isWeakEnglishAlt("Exterior view of Trendy Youth Town media architecture"),
      false
    );
  });
});

describe("임시 대체 텍스트면 공개 막힘", () => {
  it("00 · 임시 · 이미지 · IMG_1234.jpg · 공백만은 막힌다", () => {
    assert.equal(isPlaceholderAlt("00"), true);
    assert.equal(isPlaceholderAlt("임시"), true);
    assert.equal(isPlaceholderAlt("이미지"), true);
    assert.equal(isPlaceholderAlt("IMG_1234.jpg"), true);
    assert.equal(isPlaceholderAlt("   "), true);
  });

  it("한 글자는 막지 않고 경고만", () => {
    assert.equal(isPlaceholderAlt("a"), false);
    assert.equal(isShortAlt("a"), true);
  });
});

describe("임시 낱말로 시작하거나 「이미지 낱말 + 번호」 꼴은 막힘", () => {
  it("임시 낱말 + 용·값·이미지 낱말·번호", () => {
    assert.equal(isPlaceholderAlt("임시 이미지"), true);
    assert.equal(isPlaceholderAlt("테스트용"), true);
    assert.equal(isPlaceholderAlt("임시값"), true);
    assert.equal(isPlaceholderAlt("테스트용 사진 2"), true);
    assert.equal(isPlaceholderAlt("test image"), true);
    assert.equal(isPlaceholderAlt("sample photo 3"), true);
    assert.equal(isPlaceholderAlt("샘플"), true);
  });

  it("image/img/photo + 숫자", () => {
    assert.equal(isPlaceholderAlt("image 1"), true);
    assert.equal(isPlaceholderAlt("img_03"), true);
    assert.equal(isPlaceholderAlt("photo-2"), true);
    assert.equal(isPlaceholderAlt("Picture 10"), true);
    assert.equal(isPlaceholderAlt("사진1"), true);
    assert.equal(isPlaceholderAlt("이미지 3"), true);
  });

  it("문장이 이어지면 통과", () => {
    assert.equal(isPlaceholderAlt("테스트하는 팀원들"), false);
    assert.equal(isPlaceholderAlt("임시로 쓴 설명이 아닙니다"), false);
    assert.equal(isPlaceholderAlt("image of the lobby"), false);
    assert.equal(isPlaceholderAlt("사진 촬영 중인 관람객"), false);
  });
});
