const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {loadTs}=require('./helpers.cjs');
const {collectAutoFailureSignals}=loadTs('lib/luna/failures-shared.ts');
test('retrieved material with no displayed citation is not zero-search',()=>{
 const signals=collectAutoFailureSignals({answer:'찾겠습니다.',searchAttempted:true,searchResultCount:28,confidenceScore:2});
 assert.ok(signals.includes('low_confidence'));assert.ok(!signals.includes('zero_search'));
});
test('a confirmed empty retrieval remains zero-search',()=>{
 assert.ok(collectAutoFailureSignals({answer:'자료를 찾지 못했습니다.',searchAttempted:true,searchResultCount:0}).includes('zero_search'));
});
test('unknown counts and searches never attempted are not treated as empty retrieval',()=>{
 for(const count of [undefined,NaN,-1]) assert.ok(!collectAutoFailureSignals({answer:'확인 중',searchAttempted:true,searchResultCount:count}).includes('zero_search'));
 assert.ok(!collectAutoFailureSignals({answer:'안녕하세요',searchAttempted:false,searchResultCount:0}).includes('zero_search'));
});
test('other failure signals and partial-answer behavior are retained',()=>{
 assert.deepEqual(collectAutoFailureSignals({answer:'자료를 찾지 못했습니다.',intentScore:2,confidenceScore:3,classifyConfidence:0.2}),['low_intent','low_confidence','not_found','unclassified']);
 assert.deepEqual(collectAutoFailureSignals({answer:'기획 자료는 확인했습니다. 수행 자료는 찾지 못했습니다.',searchAttempted:true,searchResultCount:3}),[]);
});
test('production records pre-display retrieval and keeps display count separately',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../../app/api/luna/chat/route.ts'),'utf8');
 assert.match(source,/searchResultCount: rawSearchResultCount/);
 assert.match(source,/rawSearchResultCount = Math.max\(rawSearchResultCount \?\? 0, merged.length \+ wikiSources.length\)/);
 assert.match(source,/displayed_source_count: cards.length \+ notionSources.length \+ publicWikiSources.length/);
 const recorder=fs.readFileSync(path.join(__dirname,'../../lib/luna/failures.ts'),'utf8');
 assert.match(recorder,/const signals = collectAutoFailureSignals\(opts\)/);
});
