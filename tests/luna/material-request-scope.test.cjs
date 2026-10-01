const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {parseMaterialRequestScope,materialScopeRule}=loadTs('lib/luna/material-request-scope.ts');
test('unregistered literal locations remain target searches without a seed-name exception',()=>{
 for(const target of ['빛마을','새로운해변','샘플전시장']) {
  const scope=parseMaterialRequestScope(`${target} 미디어아트 자료 모두 찾아줘`,{mode:'target_records',targets:[target]});
  assert.equal(scope.mode,'target_records');assert.match(materialScopeRule(scope),/다른 프로젝트에도 적용할 수 있다는 이유로 범위를 넓히지 않는다/);
 }
});
test('artifact semantics are grounded in the question and survive broad wording',()=>{
 const q='빛마을 검토보고자료 전부 모아줘';
 const scope=parseMaterialRequestScope(q,{mode:'target_records',targets:['빛마을'],artifact:{quote:'검토보고자료',meaning:'검토 내용을 보고하는 문서 자체'}});
 assert.equal(scope.artifact.quote,'검토보고자료');
 assert.match(materialScopeRule(scope),/같은 프로젝트·시즌이어도 이 종류가 아니면 direct가 아니다/);
 assert.match(materialScopeRule(scope),/artifact_support/);
 assert.equal(parseMaterialRequestScope(q,{mode:'unknown',artifact:{quote:'계약서',meaning:'계약 문서'}}).artifact,undefined);
});
test('activity records retain preparation and discussion without inventing completion requirements',()=>{
 const scope=parseMaterialRequestScope('빛마을 현장 시험 자료 찾아줘',{mode:'target_records',targets:['빛마을'],artifact:{quote:'현장 시험 자료',meaning:'현장 시험과 관련된 업무 기록',kind:'activity_records'}});
 assert.equal(scope.artifact.kind,'activity_records');
 assert.match(materialScopeRule(scope),/준비·계획·논의·진행·결과 기록 모두 직접 자료/);
 assert.doesNotMatch(materialScopeRule(scope),/일정·계획·단순 언급은 mentions_artifact/);
});
test('invented target names cannot narrow a question and thematic requests stay broad',()=>{
 assert.equal(parseMaterialRequestScope('야외 조명 자료 찾아줘',{mode:'target_records',targets:['없는회사']}).mode,'unknown');
 assert.deepEqual(parseMaterialRequestScope('숲에 적용할 야간 연출 사례',{mode:'topic_references',targets:[]}),{mode:'topic_references',targets:[]});
});
