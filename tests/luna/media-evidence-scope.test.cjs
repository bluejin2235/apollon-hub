const test=require('node:test');const assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {scopeMediaToEvidence}=loadTs('lib/luna/media-evidence-scope.ts');
const image=(path,description='',drive='T')=>({type:'image',title:'image.jpg',raw_path:path,description,drive,similarity:.9});
const source={id:'doc',title:'샘플 미디어 센터 운영 매뉴얼',paths:['T:\\02 Project\\2021\\05 샘플역삼\\09 운영\\manual.pdf']};
test('source-backed project root excludes another project, extension phase and drive',()=>{
 const correct=image('02 Project/2021/05 샘플역삼/06 Design/photo.jpg');
 const extension=image('01 사업개발/2025/250805 샘플역삼 증축/photo.jpg','샘플미디어센터');
 const other=image('02 Project/2026/01 Other/photo.jpg','샘플미디어센터와 유사한 사진');
 const wrongDrive=image(correct.raw_path,'','P');
 const doc={type:'notion',title:source.title};
 assert.deepEqual(scopeMediaToEvidence([correct,extension,other,wrongDrive,doc],'샘플미디어센터 전체 자료 찾아줘',[source]),[correct,doc]);
});
test('without grounded roots a strong semantic score cannot bypass subject evidence',()=>{
 const correct=image('projects/샘플센터/photo.jpg');
 const other=image('projects/unrelated/photo.jpg');
 assert.deepEqual(scopeMediaToEvidence([correct,other],'샘플센터 전체 자료 찾아줘',[]),[correct]);
});
test('clarification followup retains the original subject and source-backed project root',()=>{
 const correct=image('02 Project/2021/05 샘플역삼/06 Design/photo.jpg');
 const wrong=image('02 Project/2026/Other/photo.jpg');
 const query='샘플미디어센터 전체 자료 찾아줘\n조건: 샘플미디어센터 관련 전체 자료(기획·운영·결과 포함)';
 assert.deepEqual(scopeMediaToEvidence([correct,wrong],query,[source]),[correct]);
});
test('incidental reference mentions never establish the referenced project root',()=>{
 const incidental={...source,title:'다른 프로젝트 제안',excerpt:'샘플미디어센터 참고',paths:['T:/02 Project/2026/Other/ref.pdf']};
 const other=image('02 Project/2026/Other/photo.jpg');
 assert.deepEqual(scopeMediaToEvidence([other],'샘플미디어센터 자료 찾아줘',[incidental]),[]);
});
test('registered project/date and complex visual queries retain existing scoped results',()=>{
 const cards=[image('Project/260204 KV/image.jpg')];
 assert.deepEqual(scopeMediaToEvidence(cards,'샘플센터 260204 KV 이미지 보여줘',[],{projectPhrases:['샘플센터']}),cards);
 assert.deepEqual(scopeMediaToEvidence(cards,'파란 유리와 LED가 어우러진 시안 보여줘',[]),cards);
});
