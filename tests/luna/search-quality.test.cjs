const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {assessSearchQuality,inspectSearchStream}=loadTs('lib/luna/search-quality.ts');
test('stream audit detects disappearing legacy cards as well as document sources',()=>{
 const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
 const card={type:'notion',url:'https://notion.so/'+id};
 const wire=JSON.stringify({type:'meta',cards:[card],notion_sources:[]})+'\n';
 assert.deepEqual(inspectSearchStream(wire,[]).disappearedIds,[id]);
 assert.deepEqual(inspectSearchStream(wire,[id]).disappearedIds,[]);
 assert.deepEqual(inspectSearchStream(wire,[],[card]).disappearedIds,[]);
});
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
test('exact duplicate aliases satisfy required coverage and cannot hide forbidden evidence',()=>{
 assert.equal(assessSearchQuality({expected:{required_notion_ids:['backup']},finalIds:['current'],aliases:{backup:'current'}}).pass,true);
 assert.equal(assessSearchQuality({expected:{forbidden_notion_ids:['backup']},finalIds:['current'],aliases:{backup:'current'}}).pass,false);
 assert.equal(assessSearchQuality({expected:null,finalIds:[],navigationComplete:false}).pass,false);
});
test('legacy Notion cards cannot bypass the approved inventory audit',()=>{
 const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
 const quality=assessSearchQuality({expected:{expect_empty:true},finalIds:[],reviewed:{direct:[],adjacent:[]},finalCards:[{type:'notion',url:'https://notion.so/'+id.replace(/-/g,'')}]});
 assert.equal(quality.pass,false);assert.deepEqual(quality.unapproved,[id]);
 assert.equal(quality.unexpectedNonempty,true);
});
test('answer links are checked mechanically across ID formats and reject unknown page identities',()=>{
 const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
 const good=assessSearchQuality({expected:{required_notion_ids:[id]},finalIds:[id],answer:'[원문](https://www.notion.so/aaaaaaaabbbbccccddddeeeeeeeeeeee)'});
 assert.equal(good.pass,true);assert.deepEqual(good.invalidAnswerLinks,[]);
 const bad=assessSearchQuality({expected:null,finalIds:[id],answer:'[잘못된 링크](https://notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)'});
 assert.equal(bad.pass,false);assert.equal(bad.invalidAnswerLinks.length,1);
});
test('semantic grading sees only displayed sources, never rejected debug candidates',()=>{
 const {semanticSourceEvidence}=loadTs('lib/luna/search-quality.ts');
 const validation=assessSearchQuality({expected:{forbidden_notion_ids:['rejected']},finalIds:['accepted']});
 const evidence=semanticSourceEvidence(validation,[{id:'accepted',title:'현장 설계',excerpt:'검증된 원문'}],{
   direct:['accepted'],adjacent:['rejected'],basis:{accepted:{quote:'검증된 원문',reason:'실제 현장 조건'},rejected:{quote:'제외된 원문',reason:'무관한 후보'}}
 });
 assert.deepEqual(evidence.review.direct,['accepted']);assert.deepEqual(evidence.review.adjacent,[]);
 assert.deepEqual(Object.keys(evidence.review.basis),['accepted']);
 assert.equal(evidence.source_validation,validation);
 assert.ok(!JSON.stringify(evidence).includes('rejected'));
});
