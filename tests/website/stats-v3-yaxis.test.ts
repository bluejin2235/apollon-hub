import assert from "node:assert/strict";
import { describe, it } from "node:test";

import "./stats-env";

import { yRange } from "../../components/website/stats-v3/v3-chart";

describe("추이 그래프 세로축 범위 (11-23: 자료 최솟값~최댓값에 맞춤)", () => {
  it("11-16~11-22 방문자 화면 값: 위가 200까지 비지 않고 100에서 끝난다", () => {
    const { lo, hi } = yRange([30, 35, 20, 25, 12, 14, 30, 13, 19, 90, 38, 22, 9, 11]);
    assert.equal(lo, 0);
    assert.equal(hi, 100);
  });

  it("값이 높은 곳에 몰리면 아래 끝이 0이 아니라 값 가까이로 올라간다", () => {
    const { lo, hi } = yRange([120, 135, 128, 150, 142]);
    assert.ok(lo > 0 && lo <= 120, `lo=${lo}`);
    assert.ok(hi >= 150 && hi <= 170, `hi=${hi}`);
  });

  it("모든 값이 0 이상이면 아래 끝이 0 밑으로 내려가지 않는다", () => {
    assert.ok(yRange([0, 1, 2, 3]).lo >= 0);
  });

  it("정수 자료는 눈금 셋이 모두 정수다", () => {
    const { lo, hi } = yRange([1, 2, 3, 2]);
    assert.ok(Number.isInteger(lo) && Number.isInteger(hi) && Number.isInteger((lo + hi) / 2), `${lo}~${hi}`);
    assert.ok(hi >= 3);
  });

  it("비율(소수) 자료도 값을 모두 담는다", () => {
    const { lo, hi } = yRange([0.31, 0.35, 0.42]);
    assert.ok(lo <= 0.31 && hi >= 0.42 && hi - lo < 0.5, `${lo}~${hi}`);
  });

  it("값이 모두 같거나 없을 때도 범위가 0이 되지 않는다", () => {
    const same = yRange([5, 5, 5]);
    assert.ok(same.hi > same.lo && same.lo <= 5 && same.hi >= 5);
    assert.deepEqual(yRange([]), { lo: 0, hi: 1 });
    const zero = yRange([0, 0]);
    assert.ok(zero.hi > zero.lo);
  });

  it("format 을 주면 눈금 글자 셋이 서로 다르다 (방문당 페이지 1.41·1.42)", () => {
    const fmt = (v: number) => v.toFixed(1);
    const { lo, hi } = yRange([1.41, 1.42], fmt);
    assert.equal(new Set([lo, (lo + hi) / 2, hi].map(fmt)).size, 3, `${lo}~${hi}`);
    assert.ok(lo <= 1.41 && hi >= 1.42);
  });

  it("극단값에서도 lo < hi 인 유한한 범위", () => {
    for (const vals of [[1e-10, 2e-10], [1e300, 1.1e300], [1e308, 1.1e308], [-1e308, 1e308], [-8e307, 8e307], [NaN, Infinity], [-5, -2]]) {
      const { lo, hi } = yRange(vals);
      assert.ok(Number.isFinite(lo) && Number.isFinite(hi) && hi > lo && Number.isFinite(hi - lo), `${vals} → ${lo}~${hi}`);
      for (const v of [...vals.filter(Number.isFinite), lo, hi]) assert.ok(Number.isFinite((v - lo) / (hi - lo)), `${vals} 좌표`);
    }
  });
});
