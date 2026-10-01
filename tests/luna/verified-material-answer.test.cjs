const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {verifiedMaterialAnswer}=loadTs('lib/luna/verified-material-answer.ts');
const source=(n,title,project='샘플 공간')=>({id:`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`,title,project_key:project,url:`https://notion.so/${String(n).padStart(32,'0')}`});
test('a preproduction completion report is not relabeled as construction completion',()=>{
 const answer=verifiedMaterialAnswer('샘플 보고서 찾아줘',{direct:[source(1,'PP 완료보고 Final Report')],adjacent:[]});
 assert.match(answer,/\*\*보고서\*\*/);
 assert.ok(!answer.includes('시공·준공'));
});
test('every reviewed document survives grouping with adjacent evidence kept separate',()=>{
 const direct=Array.from({length:30},(_,i)=>source(i+1,`설계 기록 ${i+1}`));
 const adjacent=[source(31,'조명 시험','인접 공간')];
 const basis=Object.fromEntries([...direct,...adjacent].map(s=>[s.id,{quote:'현장 조도와 설치 높이를 측정한 기록입니다.',reason:'설치 조건을 비교할 수 있는 실제 측정 기록'}]));
 const answer=verifiedMaterialAnswer('샘플 공간 관련 자료 모두 찾아줘',{direct,adjacent,basis});
 assert.equal((answer.match(/\]\(https:\/\/notion.so\//g)||[]).length,31);
 assert.match(answer,/### 샘플 공간/);assert.match(answer,/## 인접 참고 자료/);assert.match(answer,/\*\*시험·검증\*\*/);
 assert.ok(answer.indexOf('조명 시험')>answer.indexOf('## 인접 참고 자료'));
 assert.ok(!/선택|정리할까요|골라/.test(answer));
});
test('multi-project inventories show project and type counts before the complete list',()=>{
 const answer=verifiedMaterialAnswer('야외 자료 모두 찾아줘',{direct:[source(1,'기획안','가 공간'),source(2,'설계도','가 공간'),source(3,'시험 기록','나 공간')],adjacent:[]});
 assert.match(answer,/프로젝트별 구성 \(2개 묶음\)/);
 assert.match(answer,/\*\*가 공간\*\* · 2개 · 기획·제안 1, 설계 1/);
 assert.equal((answer.match(/\]\(https:\/\/notion.so\//g)||[]).length,3);
});
test('source paths and honest unread-original limits remain visible',()=>{
 const s=source(1,'현장 시험');
 const answer=verifiedMaterialAnswer('현장 자료 찾아줘',{direct:[s],adjacent:[],basis:{[s.id]:{quote:'T:\\Project\\샘플 공간\\Test\\시험.pptx',reason:'원본의 위치만 확인했으며 시험 결과는 확인하지 못했습니다.'}}});
 assert.match(answer,/시험 결과는 확인하지 못했습니다/);assert.match(answer,/시험.pptx/);
});
test('empty inventories and explicit analysis requests retain the normal answer path',()=>{
 assert.equal(verifiedMaterialAnswer('자료 찾아줘',{direct:[],adjacent:[]}),null);
 assert.equal(verifiedMaterialAnswer('두 설계 자료를 비교해줘',{direct:[source(1,'설계')],adjacent:[]}),null);
});
