const test = require('node:test');
const assert = require('node:assert/strict');
const {loadTs} = require('./helpers.cjs');
const {resolveClarifyAnswer,combineClarifyFollowup,combineScopeFollowup} = loadTs('lib/luna/clarify-followup.ts');
const {parseAskedWhat} = loadTs('lib/luna/ask-what.ts');
const {haystackMatchesAsked} = loadTs('lib/luna/search-filter.ts');
const {buildPeekClarify} = loadTs('lib/luna/project-peek.ts');
const options = ['260204 KV','260224 KV, 영상시뮬레이션','260226 미디어 타워 빛 랜드마크 kv'];

test('date-prefixed choice remains a strict folder condition',()=>{
  for (const answer of ['1', '260204 KV', '해운대스퀘어 260204 KV 이미지 보여줘']) {
    assert.equal(resolveClarifyAnswer(answer,options),'260204 KV');
    const asked = parseAskedWhat(combineClarifyFollowup('해운대스퀀어 KV 이미지 보여줘',answer,options));
    assert.ok(haystackMatchesAsked('해운대스퀘어\\260204 KV\\a.jpg',asked));
    assert.equal(haystackMatchesAsked('해운대스퀘어\\260224 KV\\a.jpg',asked),false);
  }
});
test('numbered labels and all-option selection still work',()=>{
  assert.equal(resolveClarifyAnswer('2',['1. 기획','2) 제작']),'제작');
  assert.equal(resolveClarifyAnswer('전부',options),options.join(', '));
});
test('scope-only continuation uses the most recent topic and tolerates repeated continuation',()=>{
  const recent=[{role:'user',content:'이전 프로젝트 자료 찾아줘'}, {role:'assistant',content:'응답'},
    {role:'user',content:'고래쇼 자료 찾아줘'},{role:'assistant',content:'자료 목록'}];
  assert.equal(combineScopeFollowup(recent,'전부 다 보여줘'),'고래쇼 자료 찾아줘');
  assert.equal(combineScopeFollowup([...recent,{role:'user',content:'전부 다 보여줘'}],'모두 보여주세요'),'고래쇼 자료 찾아줘');
  assert.equal(combineScopeFollowup(recent,'수원화성 야간경관 진행상황 알려줘'),null);
  assert.equal(combineScopeFollowup([], '전부 다 보여줘'),null);
});
test('folder count agrees with the choices shown',()=>{
  const result=buildPeekClarify({displayProject:'프로젝트',natureLabel:'KV',natureFolders:options.map(name=>({name,path:name,drive:'T'})),childSplits:[]});
  assert.match(result.question,/3개/);
  assert.equal(result.options.length,3);
});
