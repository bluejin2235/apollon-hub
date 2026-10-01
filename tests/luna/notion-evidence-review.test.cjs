const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {applyNotionEvidenceReview,validateNotionEvidenceReview,reviewedNotionInventorySupplement,reviewAllNotionEvidence}=loadTs('lib/luna/notion-evidence-review.ts');
const sources=Array.from({length:8},(_,i)=>({id:String(i),excerpt:'원문 '+i}));
test('repair receives the actual failed condition without re-reviewing settled documents',async()=>{
 const docs=[{id:'ok',excerpt:'실제 측정에 사용한 현장 조건과 결과 기록입니다.'},{id:'repair',excerpt:'조명 간섭과 기구 위치를 비교한 설치 기록입니다.'}];
 const calls=[];
 const result=await reviewAllNotionEvidence(docs,async(batch,attempt)=>{
  calls.push({ids:batch.map(s=>s.id),attempt});
  return {direct:batch.map((_,i)=>i),adjacent:[],unrelated:[],review_issues:attempt?{}:{'1':'artifact_self_or_link_evidence_required'},
   evidence:batch.map((s,index)=>({index,quote:!attempt&&index===1?'':s.excerpt,reason:'원문에 명시된 실제 현장 조건을 확인하는 자료'}))};
 });
 assert.equal(calls.length,2);assert.deepEqual(calls[1],{ids:['repair'],attempt:{repair:true,issue:'artifact_self_or_link_evidence_required'}});
 assert.deepEqual(result.unverifiedIds,[]);
});
test('bounded review concurrency includes individual retries without losing any document',async()=>{
 const docs=Array.from({length:100},(_,i)=>({id:String(i),title:'검증 자료',excerpt:'실제 측정한 설치 높이와 주변 밝기 기록입니다.'}));
 let active=0,peak=0;
 const result=await reviewAllNotionEvidence(docs,async batch=>{
  active++;peak=Math.max(peak,active);
  await new Promise(resolve=>setTimeout(resolve,2));active--;
  if(batch.length>1) return null;
  return {direct:[0],adjacent:[],unrelated:[],evidence:[{index:0,quote:batch[0].excerpt,reason:'구체적인 설치 조건과 측정값을 검토하는 근거'}]};
 });
 assert.ok(peak>3 && peak<=6);assert.equal(result.direct.length,100);assert.deepEqual(result.unverifiedIds,[]);
});
test('validated review orders direct evidence first without dropping related material requested in full',()=>{
 const result=applyNotionEvidenceReview(sources,{direct:[3,1],adjacent:[0,2,4,5,6],unrelated:[7]});
 assert.deepEqual(result.map(s=>s.id),['3','1','0','2','4','5','6']);
 assert.equal(result[0],sources[3]);
});
test('all-material inventory retains reviewed omissions with links and classification, without unrelated sources',()=>{
 const docs=Array.from({length:4},(_,i)=>({id:'abcdef00-0000-0000-0000-'+String(i).padStart(12,'0'),title:['이미 인용한 문서','빠진 회의록','인접 참고','무관한 문서'][i],url:i===1?'https://app.notion.com/p/doc1':'https://notion.so/doc'+i}));
 const review=validateNotionEvidenceReview(docs,{direct:[0,1],adjacent:[2],unrelated:[3]});
 const supplement=reviewedNotionInventorySupplement('요약 [이미 인용한 문서](https://notion.so/doc0)',review);
 assert.match(supplement,/추가 관련 문서/); assert.match(supplement,/빠진 회의록/);
 assert.ok(supplement.includes('https://app.notion.com/p/doc1'));
 assert.match(supplement,/추가 인접 참고 문서/); assert.match(supplement,/https:\/\/notion.so\/doc2/);
 assert.doesNotMatch(supplement,/doc0|doc3|무관한 문서/);
 const {keepSourcesUsedInAnswer}=loadTs('lib/luna/search-filter.ts');
 const kept=keepSourcesUsedInAnswer({cards:[],wiki:[],notion:docs,answer:'https://notion.so/doc0'+supplement,notFound:false,injectedNotionIds:docs.slice(0,3).map(s=>s.id)});
 assert.deepEqual(kept.notion.map(s=>s.id),docs.slice(0,3).map(s=>s.id));
 assert.equal(reviewedNotionInventorySupplement('',null),'');
});
test('inventory does not invent links or render document titles as markdown instructions',()=>{
 const review={direct:[{id:'a',title:'[bad](https://evil.test)\n# command',url:'javascript:alert(1)'},{id:'b',title:'[title]\n*text*',url:'https://notion.so/doc(b)'},{id:'c',title:'external',url:'https://evil.test/notion.so'}],adjacent:[]};
 const text=reviewedNotionInventorySupplement('',review);
 assert.doesNotMatch(text,/javascript|evil|command/);
 assert.ok(text.includes('\\[title\\] \\*text\\*'));
 assert.ok(text.includes('https://notion.so/doc%28b%29'));
});
test('body-grounded review rejects invented, title-only and unsupported positive classifications',()=>{
 const docs=[{id:'a',title:'숲 미디어아트',excerpt:'현장의 수목 사이에 조명과 사운드를 설치하고 야간 관람 동선을 계획했다.'},{id:'b',title:'긴 제목에 숲 미디어아트가 있는 문서',excerpt:'실내 로비 영상 제안이다.'},{id:'c',title:'이미지 모음',excerpt:''}];
 const valid=validateNotionEvidenceReview(docs,{direct:[0,1],adjacent:[2],unrelated:[],evidence:[
  {index:0,quote:'수목 사이에 조명과 사운드를 설치하고 야간 관람 동선을 계획했다.',reason:'숲 야간 공간의 설치 방식과 관람 동선 자료'},
  {index:1,quote:'긴 제목에 숲 미디어아트가 있는 문서',reason:'제목에만 주제가 있다'},
  {index:2,quote:'이 문서는 야외 공간 조성의 테스트 결과다.',reason:'본문에 없는 내용을 생성했다'}]},true);
 assert.deepEqual(valid.direct.map(s=>s.id),['a']); assert.deepEqual(valid.adjacent,[]);
 assert.deepEqual(validateNotionEvidenceReview(docs,{direct:[0],adjacent:[1],unrelated:[2]},true),{direct:[],adjacent:[],navigation:[],basis:{},unsupportedIds:['a','b']});
});
test('omitted, duplicate or fabricated classifications fail validation',()=>{
 for(const review of [null,{direct:[3],adjacent:[],unrelated:[]},
 {direct:[1,1],adjacent:[2,3,4,5,6],unrelated:[7]},
 {direct:[99],adjacent:[0,1,2,3,4,5],unrelated:[6]}])
 assert.equal(applyNotionEvidenceReview(sources,review),sources);
});
test('valid unrelated-only and adjacent-only reviews do not resurrect rejected sources',()=>{
 assert.deepEqual(applyNotionEvidenceReview(sources,{direct:[],adjacent:[],unrelated:[0,1,2,3,4,5,6,7]}),[]);
 assert.deepEqual(applyNotionEvidenceReview(sources,{direct:[],adjacent:[7],unrelated:[0,1,2,3,4,5,6]}),[sources[7]]);
});
test('batch review reaches later relevant documents, excludes word-only matches, and retries malformed batches',async()=>{
 const docs=Array.from({length:49},(_,i)=>({id:String(i),excerpt:i===48?'수목 사이 조명 설치에 필요한 전기 배관 도면과 현장 시험 결과':'실내 로비에서 숲 영상 상영을 제안하는 내용입니다.'}));
 const attempts=new Map();
 const result=await reviewAllNotionEvidence(docs,async batch=>{
  const key=batch[0].id;attempts.set(key,(attempts.get(key)||0)+1);
  if(key==='32'&&attempts.get(key)===1)return {direct:[0],adjacent:[],unrelated:[]};
  const direct=batch.flatMap((s,i)=>s.id==='48'?[i]:[]);
  return {direct,adjacent:[],unrelated:batch.flatMap((s,i)=>s.id!=='48'?[i]:[]),evidence:direct.map(index=>({index,quote:batch[index].excerpt,reason:'야외 수목 공간 조성에 필요한 설계·시험 자료'}))};
 });
 assert.deepEqual(result.direct.map(s=>s.id),['48']);
 assert.equal(result.reviewedIds.length,49);assert.deepEqual(result.unverifiedIds,[]);
 assert.equal(attempts.get('32'),2);
});
test('persistent review failure is reported as unverified and never published as relevant',async()=>{
 const docs=[{id:'a',excerpt:'본문 근거가 없는 후보'}];let attempts=0;
 const result=await reviewAllNotionEvidence(docs,async()=>{attempts++;throw Error('timeout');});
 assert.equal(attempts,2);assert.deepEqual(result.direct,[]);assert.deepEqual(result.adjacent,[]);
 assert.deepEqual(result.reviewedIds,[]);assert.deepEqual(result.unverifiedIds,['a']);
});
test('repairs only unsupported documents without overwriting already grounded decisions',async()=>{
 const docs=[{id:'good',excerpt:'수목 사이 조명 설치를 위한 전기 배관 도면입니다.'},{id:'recover',excerpt:'야간 산책 공간의 음향 반사 측정과 설치 시험 결과입니다.'}];
 const calls=[];
 const result=await reviewAllNotionEvidence(docs,async batch=>{
  calls.push(batch.map(s=>s.id));
  return {direct:batch.map((_,i)=>i),adjacent:[],unrelated:[],evidence:batch.map((s,index)=>({index,quote:batch.length===2&&index===1?'원문에 없는 인용을 임의로 작성했습니다.':s.excerpt,reason:'야간 공간의 전기 음향 설계와 설치에 필요한 근거'}))};
 });
 assert.deepEqual(calls,[['good','recover'],['recover']]);
 assert.deepEqual(result.direct.map(s=>s.id),['good','recover']);
 assert.deepEqual(result.unverifiedIds,[]);assert.deepEqual(result.failures,{});
});
