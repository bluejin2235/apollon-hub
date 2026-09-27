const test=require('node:test'),assert=require('node:assert/strict');
const {createClient}=require('@supabase/supabase-js');
const {loadTs}=require('./helpers.cjs');
const {postgrestTextList,postgrestTextBatches}=loadTs('lib/luna/postgrest-text-list.ts');
const {currentNasBodyFiles}=loadTs('lib/luna/nas-source-version.ts');

// Small quoted-IN decoder matching the documented escape grammar. This is not
// a running PostgREST instance; the HTTP client/URL construction below is real.
function decodeList(filter){
 const body=filter.slice(4,-1),out=[];let value='',quoted=false;
 for(let i=0;i<body.length;i++){
  const c=body[i];
  if(c==='\\'&&quoted){value+=body[++i];continue;}
  if(c==='"'){quoted=!quoted;continue;}
  if(c===','&&!quoted){out.push(value);value='';continue;}
  value+=c;
 }
 if(quoted)throw Error('unclosed quote');out.push(value);return out;
}
const paths=['01 사업개발\\해운대\\제안(최종).pdf','01 사업개발\\해운대\\KV,영상\\기획.pptx','01 사업개발\\해운대\\plain.pdf','special\\quote"name,(x).pdf'];
test('text list round-trips backslashes, quotes, commas and parentheses without changing identities',()=>{
 assert.deepEqual(decodeList('in.'+postgrestTextList(paths)),paths);
 assert.equal(postgrestTextList(['a\\b(c)']), '("a\\\\b(c)")');
 const long=Array.from({length:100},(_,i)=>'회사\\'+('가'.repeat(100))+i+'(안).pdf');
 const batches=postgrestTextBatches(long);
 assert.ok(batches.length>1);assert.deepEqual(batches.flat(),long);
 assert.ok(batches.every(batch=>encodeURIComponent(postgrestTextList(batch)).length<=6000));
});
test('installed client reproduces quoted Windows path loss with .in(); raw escaped filter preserves it',async()=>{
 const captured=[];
 const db=createClient('https://example.invalid','placeholder',{
  auth:{persistSession:false,autoRefreshToken:false},
  global:{fetch:async input=>{captured.push(new URL(String(input)).searchParams.get('path'));return new Response('[]',{status:200,headers:{'Content-Type':'application/json'}});}}
 });
 await db.from('nas_file_text').select('path').in('path',paths.slice(0,3));
 await db.from('nas_file_text').select('path').filter('path','in',postgrestTextList(paths));
 assert.notDeepEqual(decodeList(captured[0]),paths.slice(0,3));
 assert.deepEqual(decodeList(captured[1]),paths);
});
test('freshness uses the actual client transport and preserves all path variants',async()=>{
 const files=paths.map(path=>({path,drive:'T',status:'ok',modified_at:'2026-09-26T00:00:00Z',size_bytes:100,type:'file',scan_batch:'2026-09-26T01:00:00Z'}));
 let requests=0;
 const db=createClient('https://example.invalid','placeholder',{
  auth:{persistSession:false,autoRefreshToken:false},
  global:{fetch:async input=>{
   requests++;const url=new URL(String(input));
   if (!url.searchParams.has('path')) return new Response(JSON.stringify({scan_batch:'2026-09-26T01:00:00Z'}),{status:200,headers:{'Content-Type':'application/json'}});
   const wanted=decodeList(url.searchParams.get('path'));
   const rows=files.filter(row=>wanted.includes(row.path));
   return new Response(JSON.stringify(rows),{status:200,headers:{'Content-Type':'application/json'}});
  }}
 });
 const current=await currentNasBodyFiles(db,paths);
 assert.equal(requests,3);assert.deepEqual([...current.keys()],paths);
});

test('derived report validation preserves quoted Windows paths through the real client transport',async()=>{
 const {reportSourcesAreCurrent}=loadTs('lib/luna/report-freshness.ts');
 const stamp='2026-09-26T00:00:00Z';
 const db=createClient('https://example.invalid','placeholder',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async input=>{
  const url=new URL(String(input));
  const rows=url.searchParams.has('path')?decodeList(url.searchParams.get('path')).map(path=>({path,drive:'T',modified_at:stamp,size_bytes:100,type:'file',scan_batch:stamp})):{scan_batch:stamp};
  return new Response(JSON.stringify(rows),{status:200,headers:{'Content-Type':'application/json'}});
 }}});
 assert.equal(await reportSourcesAreCurrent(db,paths.map(ref=>({type:'nas',ref,drive:'T',modified_at:stamp,size_bytes:100}))),true);
});
