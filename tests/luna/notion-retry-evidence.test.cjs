const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {mergeNotionSearchOutcomes}=loadTs('lib/luna/notion.ts',{'@/lib/luna/workserver':{prepareSearchTerms:()=>[]}});
const source=(id,score)=>({id,title:id,url:'https://notion.so/'+id,excerpt:'본문 근거 '+id,match_score:score,keyword_score:score});
const outcome=sources=>({status:'ok',sources,queries:['query'],rounds:1});
test('retry keeps original evidence and adds new evidence despite incomparable score scales',()=>{
 const a=Array.from({length:24},(_,i)=>source('original-'+i,30-i));
 const b=Array.from({length:24},(_,i)=>source('retry-'+i,1000-i));
 const merged=mergeNotionSearchOutcomes(outcome(a),outcome(b),{preserveRounds:true,limit:48});
 assert.equal(merged.sources.length,48);
 const prompt=merged.sources.sort((a,b)=>b.match_score-a.match_score).slice(0,24);
 assert.ok(prompt.some(x=>x.id==='original-10'));
 assert.ok(prompt.some(x=>x.id==='retry-0'));
 assert.ok(prompt.every(x=>x.excerpt));
 assert.equal(new Set(merged.sources.map(x=>x.id)).size,48);
});
test('merging indexed results never silently applies the five-page live-search display limit',()=>{
 const a=Array.from({length:24},(_,i)=>source('page-'+i,30-i));
 assert.equal(mergeNotionSearchOutcomes(outcome(a),outcome([])).sources.length,24);
});
