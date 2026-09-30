const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {prepareReviewEvidence}=loadTs('lib/luna/review-evidence-references.ts');
const {validateNotionEvidenceReview}=loadTs('lib/luna/notion-evidence-review.ts');
test('emoji at either span boundary remains valid Unicode and exact source evidence',()=>{
 for (const position of [119,159,239,279]) {
  const excerpt='가'.repeat(position)+'🌳 실제 야외 숲 현장의 설치 검증 내용입니다.'.repeat(8);
  const prepared=prepareReviewEvidence([{id:'emoji',title:'현장 🌳',excerpt}]);
  assert.equal(prepared.text.isWellFormed(),true);
  const spans=[...prepared.text.matchAll(/\[근거 (\d+)\] ([^\n]*)/g)];
  assert.ok(spans.some(m=>m[2].includes('🌳')));
  for(const match of spans) {
   assert.ok(excerpt.includes(match[2]));
   assert.ok(match[2].length<=160);
  }
 }
});
test('reference selection preserves late exact evidence without generated quotation changes',()=>{
 const sources=[{id:'a',title:'기획서',excerpt:'일반 소개 '.repeat(100)+'\n실제 수목 사이에 조명과 사운드를 설치하는 현장 시험 기록입니다.'}];
 const prepared=prepareReviewEvidence(sources);
 const span=Number([...prepared.text.matchAll(/\[근거 (\d+)\] ([^\n]*)/g)].find(m=>m[2].includes('현장 시험 기록'))[1]);
 const review=prepared.resolve({direct:[0],adjacent:[],unrelated:[],evidence:[{index:0,span,reason:'공간 조성에 필요한 실제 현장 시험 근거'}]});
 const checked=validateNotionEvidenceReview(sources,review,true);
 assert.deepEqual(checked.direct.map(s=>s.id),['a']);
 assert.match(checked.basis.a.quote,/현장 시험 기록/);
});
test('invalid or cross-document references never fall back to a generated quotation',()=>{
 const sources=[{id:'a',title:'원문',excerpt:'원문에 존재하는 현장 조건과 설계 제약 내용입니다.'}];
 const prepared=prepareReviewEvidence(sources);
 const review=prepared.resolve({direct:[0],adjacent:[],unrelated:[],evidence:[{index:0,span:99,quote:sources[0].excerpt,reason:'원문의 설치 설계 조건을 참고하는 자료'}]});
 assert.deepEqual(validateNotionEvidenceReview(sources,review,true).unsupportedIds,['a']);
});
test('a previous relevance claim is visible for scrutiny but cannot become source evidence',()=>{
 const sources=[{id:'a',title:'기획안',excerpt:'이 문서는 상징적 형태와 시각적 콘셉트만 설명합니다.',review_proposal:{classification:'adjacent',quote:'근거 없는 설치 기술',reason:'원문에 없는 현장 테스트를 했다는 주장'}}];
 const prepared=prepareReviewEvidence(sources);
 assert.match(prepared.text,/원문에 없는 현장 테스트/);
 const review=prepared.resolve({direct:[],adjacent:[0],unrelated:[],evidence:[{index:0,span:0,reason:'구체적인 적용 제약이 실제 본문에 있는지 검증한다'}]});
 assert.equal(review.evidence[0].quote,sources[0].excerpt);
 assert.ok(!review.evidence[0].quote.includes('현장 테스트'));
});
test('verification requires a grounded transferable fact and records its application limits',()=>{
 const source={id:'a',title:'설치 조건',excerpt:'수위 변동을 고려해 방수 조명 기구를 설치하고 전원 접속부를 수면 위에 배치한다.'};
 const prepared=prepareReviewEvidence([source],true);
 const base={direct:[],adjacent:[0],unrelated:[],evidence:[{index:0,span:0,reason:'분위기를 야외 숲길에도 참고할 수 있다.'}]};
 assert.equal(prepared.resolve(base).evidence[0].quote,'');
 const valid=prepared.resolve({...base,evidence:[{...base.evidence[0],relation:'transferable_fact',fact_span:0,application:'수위 변동 구간의 전원 접속부 높이를 검토하는 데 적용한다.',limitation:'숲길의 실제 수위와 전기 조건은 별도 현장 확인이 필요하다.'}]});
 assert.equal(valid.evidence[0].quote,source.excerpt);
 assert.match(valid.evidence[0].reason,/실제 수위/);
 const invalid=prepared.resolve({...base,evidence:[{...valid.evidence[0],span:0,fact_span:99}]});
 assert.equal(invalid.evidence[0].quote,'');
});
