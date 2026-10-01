const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {prepareReviewEvidence}=loadTs('lib/luna/review-evidence-references.ts');
const {validateNotionEvidenceReview}=loadTs('lib/luna/notion-evidence-review.ts');
test('direct evidence requires target, artifact and phase agreement when enabled',()=>{
 const sources=[{id:'a',title:'샘플 문서',excerpt:'이 문서는 시운전 결과를 기록한 현장 검증 보고서입니다.'}];
 const prepared=prepareReviewEvidence(sources,true,true);
 const evidence={index:0,span:0,reason:'요청한 현장 시운전 결과가 기록된 실제 보고서입니다.'};
 for(const request_match of [undefined,{target:true,artifact:false,phase:true},{target:true,artifact:true,phase:false}]) {
  const r=prepared.resolve({direct:[0],adjacent:[],unrelated:[],evidence:[{...evidence,request_match}]});
  assert.deepEqual(validateNotionEvidenceReview(sources,r,true).unsupportedIds,['a']);
 }
 const r=prepared.resolve({direct:[0],adjacent:[],unrelated:[],evidence:[{...evidence,request_match:{target:true,artifact:true,phase:true}}]});
 assert.equal(validateNotionEvidenceReview(sources,r,true).direct.length,1);
});
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
 const valid=prepared.resolve({...base,evidence:[{...base.evidence[0],relation:'transferable_fact',fact_kind:'design_constraint',fact_span:0,application:'수위 변동 구간의 전원 접속부 높이를 검토하는 데 적용한다.',limitation:'숲길의 실제 수위와 전기 조건은 별도 현장 확인이 필요하다.'}]});
 assert.equal(valid.evidence[0].quote,source.excerpt);
 assert.match(valid.evidence[0].reason,/실제 수위/);
 const invalid=prepared.resolve({...base,evidence:[{...valid.evidence[0],span:0,fact_span:99}]});
 assert.equal(invalid.evidence[0].quote,'');
});
test('independent verification excludes visual-only transfer while retaining an actual installation constraint',()=>{
 const sources=[
  {id:'visual',title:'화면 구성',excerpt:'수직으로 뻗은 나무 이미지에 빛줄기가 비치고 먼 배경에는 푸른 안개를 묘사한다.',review_proposal:{classification:'adjacent',reason:'실제 현장 설치 방법으로 사용 가능하다는 이전의 잘못된 주장'}},
  {id:'physical',title:'현장 조건',excerpt:'보행자의 눈부심을 줄이기 위해 기구를 동선 바깥에 설치하고 차광판으로 배광을 제한한다.'}
 ];
 const prepared=prepareReviewEvidence(sources,true);
 assert.ok(!prepared.text.includes('이전의 잘못된 주장'));
 const resolved=prepared.resolve({direct:[],adjacent:[0,1],unrelated:[],evidence:[
  {index:0,span:0,fact_span:0,relation:'transferable_fact',fact_kind:'visual_motif',reason:'보행 공간에도 이미지를 활용할 수 있다.',application:'이 화면의 분위기를 보행 공간에 참고할 수 있다.',limitation:'실제 기구 설치 조건은 확인되지 않았다.'},
  {index:1,span:0,fact_span:0,relation:'transferable_fact',fact_kind:'design_constraint',reason:'현장의 실제 눈부심 제한 방법이다.',application:'보행자의 시야에서 눈부심을 제한하는 기구 배치에 적용한다.',limitation:'현장 동선과 기구 배광은 별도 확인해야 한다.'}
 ]});
 const checked=validateNotionEvidenceReview(sources,resolved,true);
 assert.deepEqual(checked.adjacent.map(s=>s.id),['physical']);
 assert.deepEqual(resolved.unrelated,[0]);
 assert.deepEqual(checked.unsupportedIds,[]);
});
test('a missing fact type remains unresolved, while an explicitly requested visual reference can remain direct',()=>{
 const sources=[{id:'visual',title:'화면 참고',excerpt:'무대 화면의 원경에는 산과 구름을 묘사하고 전경에는 붉은 꽃을 배치한다.'}];
 const prepared=prepareReviewEvidence(sources,true);
 const evidence={index:0,span:0,fact_span:0,relation:'transferable_fact',reason:'질문에서 요청한 화면의 시각적 구성이다.',application:'화면의 색상과 시각적인 구성에 참고한다.',limitation:'실제 현장 설치 조건과는 관련이 없다.'};
 const missing=prepared.resolve({direct:[],adjacent:[0],unrelated:[],evidence:[evidence]});
 assert.deepEqual(validateNotionEvidenceReview(sources,missing,true).unsupportedIds,['visual']);
 const direct=prepared.resolve({direct:[0],adjacent:[],unrelated:[],evidence:[{...evidence,fact_kind:'visual_motif'}]});
 assert.deepEqual(validateNotionEvidenceReview(sources,direct,true).direct.map(s=>s.id),['visual']);
});

test('a grounded design review can remain useful before implementation or measured results',()=>{
 const source={id:'review',title:'설계 검토',excerpt:'보행 시야의 눈부심을 줄일 기구 위치와 차광판 형상을 비교하고 주변 간판의 광원 간섭 여부를 시험해야 한다.'};
 const prepared=prepareReviewEvidence([source],true);
 const result=prepared.resolve({direct:[],adjacent:[0],unrelated:[],evidence:[{
  index:0,span:0,fact_span:0,relation:'transferable_fact',fact_kind:'design_review',reason:'시야와 광원 간섭을 위한 구체적인 설계 검토 항목이다.',
  application:'보행 공간의 조명 대안을 고를 때 눈부심과 주변 광원 간섭 시험 항목으로 적용한다.',limitation:'시험 전 검토안이며 실제 광량과 기구 성능은 확인되지 않았다.'
 }]});
 assert.deepEqual(validateNotionEvidenceReview([source],result,true).adjacent.map(s=>s.id),['review']);
});
