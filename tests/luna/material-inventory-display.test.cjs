const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {splitMaterialInventoryDisplay}=loadTs('lib/luna/material-inventory-display.ts');
test('collapsible adjacent results retain every link, boundary note and NAS section',()=>{
 const body='직접 관련 문서 1개와 인접 참고 문서 2개를 구분했습니다.\n\n## 직접 관련 자료\n\n- [직접](https://notion.so/a)\n\n## 인접 참고 자료\n\n- [참고1](https://notion.so/b)\n- [참고2](https://notion.so/c)\n\n확인된 자료의 목록이며, 전수 확인이 아닙니다.\n\n## Work서버 자료 위치\n\n파일의 실제 경로';
 const parts=splitMaterialInventoryDisplay(body);
 assert.equal(parts.count,2);assert.equal(parts.initiallyOpen,false);
 assert.match(parts.before,/https:\/\/notion.so\/a/);assert.match(parts.adjacent,/https:\/\/notion.so\/c/);assert.match(parts.after,/Work서버 자료 위치/);
 assert.equal([parts.before,parts.adjacent,parts.after].join('\n\n'),body);
});
test('adjacent-only searches show available evidence and ordinary prose is untouched',()=>{
 const body='확인 범위에서 요청 조건에 직접 맞는 문서는 찾지 못했습니다.\n\n## 인접 참고 자료\n\n- [참고](https://notion.so/b)';
 assert.equal(splitMaterialInventoryDisplay(body).initiallyOpen,true);
 assert.equal(splitMaterialInventoryDisplay('일반 답변\n## 인접 참고 자료\n- [링크](https://notion.so/b)'),null);
});
