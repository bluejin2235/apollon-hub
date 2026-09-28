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
