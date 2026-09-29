const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {assessSearchQuality,inspectSearchStream}=loadTs('lib/luna/search-quality.ts');
test('detects a good answer hiding required material and displaying unrelated material',()=>{
 const result=assessSearchQuality({expected:{required_notion_ids:['a','b'],forbidden_notion_ids:['wrong']},finalIds:['a','wrong'],reviewed:{direct:['a','b'],adjacent:[]}});
 assert.equal(result.pass,false);assert.deepEqual(result.missing,['b']);assert.deepEqual(result.forbidden,['wrong']);assert.deepEqual(result.omittedApproved,['b']);assert.deepEqual(result.unapproved,['wrong']);assert.equal(result.recall,0.5);
});
test('no reference labels means unmeasured completeness, not perfect recall',()=>{
 const result=assessSearchQuality({expected:null,finalIds:['a']});
 assert.equal(result.labeled,false);assert.equal(result.recall,null);
});
test('stream audit catches sources that appeared and then disappeared',()=>{
 const wire=[{type:'ids'},{type:'search_snapshot',notion_sources:[{id:'a'},{id:'wrong'}]},{type:'meta',notion_sources:[]}].map(JSON.stringify).join('\r\n')+'\r\n답변';
 assert.deepEqual(inspectSearchStream(wire,['a']).disappearedIds,['wrong']);
 assert.equal(assessSearchQuality({expected:null,finalIds:['a'],disappearedIds:['wrong']}).pass,false);
});
test('empty negative cases and unfinished validation fail closed',()=>{
 assert.equal(assessSearchQuality({expected:{expect_empty:true},finalIds:['wrong']}).pass,false);
 assert.equal(assessSearchQuality({expected:{expect_empty:true},finalIds:[]}).pass,true);
 assert.equal(assessSearchQuality({expected:null,finalIds:[],unverifiedIds:['pending']}).pass,false);
});
