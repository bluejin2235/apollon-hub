const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {parseMaterialRequestScope,materialScopeRule}=loadTs('lib/luna/material-request-scope.ts');
test('unregistered literal locations remain target searches without a seed-name exception',()=>{
 for(const target of ['빛마을','새로운해변','샘플전시장']) {
  const scope=parseMaterialRequestScope(`${target} 미디어아트 자료 모두 찾아줘`,{mode:'target_records',targets:[target]});
  assert.equal(scope.mode,'target_records');assert.match(materialScopeRule(scope),/다른 프로젝트에도 적용할 수 있다는 이유로 범위를 넓히지 않는다/);
 }
});
test('invented target names cannot narrow a question and thematic requests stay broad',()=>{
 assert.equal(parseMaterialRequestScope('야외 조명 자료 찾아줘',{mode:'target_records',targets:['없는회사']}).mode,'unknown');
 assert.deepEqual(parseMaterialRequestScope('숲에 적용할 야간 연출 사례',{mode:'topic_references',targets:[]}),{mode:'topic_references',targets:[]});
});
