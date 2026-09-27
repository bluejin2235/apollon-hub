const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {Readable}=require('node:stream');const {EventEmitter}=require('node:events');
const {loadTs}=require('./helpers.cjs');
const {describeNasError}=loadTs('lib/luna/nas-error.ts');
function load(overrides={}){
 return loadTs('lib/luna/nas-text.ts',{
  'node:fs':{...fs,statSync:()=>({size:10}),createReadStream:()=>Readable.from([Buffer.from('fixture')])},
  'node:path':path,yauzl:{default:{open(){throw Error('unexpected zip open')}}},
  '@/lib/luna/embedding':{contentHash:()=>''},...overrides
 });
}
test('thrown object fields and nested causes survive without arbitrary payloads',()=>{
 const e={code:'ETIMEDOUT',message:'read timed out',request:{headers:{authorization:'private'}},payload:'source text'};
 e.cause=e;
 const output=describeNasError(e);
 assert.match(output,/ETIMEDOUT/);assert.match(output,/read timed out/);assert.match(output,/circular/);
 assert.doesNotMatch(output,/private|source text|\[object Object\]/);
 assert.ok(describeNasError({message:'x'.repeat(3000)},200).length<=200);
 assert.doesNotMatch(describeNasError({message:'Bearer top-secret sk-abcdefghijklmnop'}),/top-secret|sk-abcdefghijklmnop/);
});
test('oversized whole-buffer formats and >1GiB PPTX are rejected before opening source streams',async()=>{
 let reads=0,opens=0;
 for(const ext of ['pdf','docx','xlsx','xls','txt','md','pptx']){
  const mod=load({'node:fs':{...fs,statSync:()=>({size:ext==='pptx'?2*1024**3:65*1024**2}),createReadStream:()=>{reads++;throw Error('must not read')}},
   yauzl:{default:{open(){opens++;throw Error('must not open')}}}});
  const result=await mod.extractNasFileText('oversized',ext);
  assert.equal(result.status,'skipped');assert.equal(result.skipReason,'too_large');assert.equal(result.text,'');
 }
 assert.equal(reads,0);assert.equal(opens,0);
});
test('a source growing beyond stat size is stopped while streaming',async()=>{
 let stream;
 const mod=load({'node:fs':{...fs,statSync:()=>({size:10}),createReadStream:()=>{
  const block=Buffer.alloc(4*1024**2);stream=Readable.from(Array(17).fill(block));return stream;
 }}});
 const result=await mod.extractNasFileText('growing','txt');
 assert.equal(result.skipReason,'too_large');assert.equal(result.text,'');assert.equal(stream.destroyed,true);
});
test('non-Error parser objects preserve diagnostics instead of object Object',async()=>{
 const mod=load({'xlsx':{read(){throw {code:'EIO',message:'parser read failed'}}}});
 const result=await mod.extractNasFileText('small.xlsx','xlsx');
 assert.equal(result.status,'failed');assert.match(result.error,/EIO/);assert.match(result.error,/parser read failed/);
});
test('DOCX missing main document is an explicit parser-incompatible corrupt skip',async()=>{
 const mod=load({'mammoth':{extractRawText:async()=>{throw {message:'Could not find main document part. Are you sure this is a valid .docx file?'}}}});
 const result=await mod.extractNasFileText('sample.docx','docx');
 assert.equal(result.status,'skipped');assert.equal(result.skipReason,'corrupt');assert.match(result.error,/main document part/);
});
test('PPTX selected XML cap closes archive before opening oversized entry',async()=>{
 const zip=new EventEmitter();let closed=false,opened=0;
 zip.close=()=>{closed=true};zip.readEntry=()=>setImmediate(()=>zip.emit('entry',{fileName:'ppt/slides/slide1.xml',uncompressedSize:9*1024**2}));
 zip.openReadStream=()=>{opened++};
 const mod=load({yauzl:{default:{open:(_p,_o,cb)=>cb(null,zip)}}});
 const result=await mod.extractNasFileText('sample.pptx','pptx');
 assert.equal(result.skipReason,'too_large');assert.equal(closed,true);assert.equal(opened,0);
});
test('PPTX streamed XML cap rejects inaccurate declared size and destroys stream',async()=>{
 const zip=new EventEmitter();let closed=false,stream;
 zip.close=()=>{closed=true};zip.readEntry=()=>setImmediate(()=>zip.emit('entry',{fileName:'ppt/slides/slide1.xml',uncompressedSize:10}));
 zip.openReadStream=(_entry,cb)=>{stream=Readable.from([Buffer.alloc(9*1024**2)]);cb(null,stream)};
 const mod=load({yauzl:{default:{open:(_p,_o,cb)=>cb(null,zip)}}});
 const result=await mod.extractNasFileText('sample.pptx','pptx');
 assert.equal(result.skipReason,'too_large');assert.equal(result.text,'');assert.equal(closed,true);assert.equal(stream.destroyed,true);
});
test('321MB PPTX still uses selective XML reads and never whole-file buffering',async()=>{
 const zip=new EventEmitter();let index=0,buffered=0;
 zip.close=()=>{};zip.readEntry=()=>setImmediate(()=>index++===0?zip.emit('entry',{fileName:'ppt/slides/slide1.xml',uncompressedSize:30}):zip.emit('end'));
 zip.openReadStream=(_entry,cb)=>cb(null,Readable.from([Buffer.from('<a:t>source evidence</a:t>')]));
 const mod=load({'node:fs':{...fs,statSync:()=>({size:320750445}),createReadStream:()=>{buffered++;throw Error('must not buffer')}},
  yauzl:{default:{open:(_p,_o,cb)=>cb(null,zip)}}});
 const result=await mod.extractNasFileText('sample.pptx','pptx');
 assert.equal(result.status,'ok');assert.equal(result.text,'source evidence');assert.equal(buffered,0);
});
