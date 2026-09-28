const test = require('node:test');
const assert = require('node:assert/strict');
const {loadTs} = require('./helpers.cjs');
const {imageResultAnswer, scopeResultNote} = loadTs('lib/luna/result-answer.ts');
test('image answer uses every filtered card and only its actual parent path', () => {
  const cards = [
    {type:'image',raw_path:'Project\\260201 KV\\PSD\\a.jpg',drive:'T'},
    {type:'image',raw_path:'Project\\260201 KV\\PSD\\b.jpg',drive:'T'},
    {type:'image',raw_path:'Project\\260201 KV\\c.jpg',drive:'P'},
    {type:'web',raw_path:'Unrelated\\folder'}
  ];
  const answer=imageResultAnswer(cards);
  assert.match(answer,/이미지 3건/);
  assert.ok(answer.includes('2건: `T:\\Project\\260201 KV\\PSD`'));
  assert.ok(answer.includes('1건: `P:\\Project\\260201 KV`'));
  assert.ok(!answer.includes('Unrelated'));
});
test('missing paths do not invent a source location; scope is explicitly bounded', () => {
  assert.match(imageResultAnswer([{type:'image',title:'a'}]),/원본 경로는 확인되지/);
  assert.match(scopeResultNote(2,3,0),/노션 2건/);
  assert.match(scopeResultNote(2,3,0),/빠짐없이 확인한 목록은 아닙니다/);
});

const {formatNasFilePath,nasExplorerFilePair}=loadTs('lib/luna/nas-path.ts');
const {modalFilePath}=loadTs('lib/luna/image-modal-path.ts');
test('image modal accepts a file path without duplicating its filename',()=>{
 const settings={mode:'office',prefixT:'',prefixP:''};
 const raw='Project\\KV\\scene.jpg';
 assert.equal(formatNasFilePath('T',raw,settings,'scene.jpg'),'T:\\'+raw);
 assert.equal(formatNasFilePath('T','Project\\KV',settings,'scene.jpg'),'T:\\'+raw);
 assert.equal(modalFilePath({type:'image',title:'scene.jpg',raw_path:raw,drive:'T'},'unc',settings).split('scene.jpg').length,2);
 assert.equal(JSON.stringify(nasExplorerFilePair('T',raw,'scene.jpg')).includes('scene.jpg\\\\scene.jpg'),false);
});
