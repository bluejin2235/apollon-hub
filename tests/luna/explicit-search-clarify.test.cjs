const test=require('node:test');const assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {shouldSkipProjectClarify}=loadTs('lib/luna/question-intent.ts');
test('explicit all-source retrieval proceeds without asking for the same scope again',()=>{
 for(const q of ['샘플미디어센터 전체 자료 찾아줘','샘플 미디어 센터 관련 모든 문서 보여주세요']) {
  assert.equal(shouldSkipProjectClarify(q,[]),true);
 }
});
test('unspecified or non-retrieval requests retain clarification behavior',()=>{
 for(const q of ['전체 자료 찾아줘','샘플센터 자료 찾아줘','샘플센터 전체 자료 삭제해줘','샘플센터 전체 자료 찾아줘 아니면 다른 프로젝트로 할까']) {
  assert.equal(shouldSkipProjectClarify(q,[]),false);
 }
});
