import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import "./stats-env";

import {
  Change,
  DeltaBlock,
  EmptyText,
  FAILED_TEXT,
  List,
  LOADING_TEXT,
  NotComparable,
  Source,
  StatusLine,
  TrendCard,
  type SourceState
} from "../../components/website/stats-v3/v3-parts";

// 테스트 실행기(tsx)는 부품의 JSX 를 React.createElement 로 바꾼다. 그 React 를 전역에 둔다(그리는 때 찾는다)
(globalThis as { React?: typeof React }).React = React;

const NONE = { delta: null, tone: "flat" as const, previous: null };

function inside(state: SourceState, child: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(createElement(Source, { state }, child));
}

describe("빈 글 · 비교 불가는 자료가 준비됐을 때만", () => {
  it("불러오는 중이면 빈 글 대신 「불러오는 중입니다」", () => {
    const html = inside("loading", createElement(List, { items: [], empty: "이 기간에 새로 보인 검색어가 없어요." }));
    assert.match(html, new RegExp(LOADING_TEXT));
    assert.doesNotMatch(html, /없어요/);
    assert.match(inside("loading", createElement(EmptyText, null, "기록이 없어요")), new RegExp(LOADING_TEXT));
    assert.match(inside("loading", createElement(StatusLine, { status: "ready", empty: "값이 없어요" })), new RegExp(LOADING_TEXT));
  });

  it("실패면 실패 글, 「비교 불가」 · 「앞 기간 기록 없음」도 쓰지 않는다", () => {
    assert.match(inside("error", createElement(EmptyText, null, "기록이 없어요")), new RegExp(FAILED_TEXT.slice(0, 8)));
    const change = inside("error", createElement(Change, { delta: NONE }));
    assert.match(change, /불러오지 못함/);
    assert.doesNotMatch(change, /비교 불가/);
    const block = inside("loading", createElement(DeltaBlock, { delta: NONE }));
    assert.match(block, /불러오는 중/);
    assert.doesNotMatch(block, /기록 없음/);
    const trend = inside(
      "error",
      createElement(TrendCard, {
        title: "흐름",
        fact: { tone: "none", text: "이 기간에 확인한 기록이 없어요.", fair: false, fairText: "" }
      })
    );
    assert.doesNotMatch(trend, /확인한 기록이 없어요/);
    assert.match(trend, new RegExp(FAILED_TEXT.slice(0, 8)));
  });

  it("준비됐으면 원래 빈 글 · 비교 불가 그대로, 바깥이 불러오는 중이면 안쪽이 준비여도 불러오는 중", () => {
    assert.match(inside("ready", createElement(EmptyText, null, "기록이 없어요")), /기록이 없어요/);
    assert.match(inside("ready", createElement(NotComparable)), /비교 불가/);
    assert.match(renderToStaticMarkup(createElement(NotComparable)), /비교 불가/);
    const nested = renderToStaticMarkup(
      createElement(Source, { state: "loading" }, createElement(Source, { state: "ready" }, createElement(EmptyText, null, "없어요")))
    );
    assert.match(nested, new RegExp(LOADING_TEXT));
  });
});
