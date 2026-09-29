const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {prepareReviewEvidence}=loadTs('lib/luna/review-evidence-references.ts');
const {validateNotionEvidenceReview}=loadTs('lib/luna/notion-evidence-review.ts');
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
