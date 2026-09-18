export type SourceGlossaryTerm = {
  id: string;
  word: string;
  def: string;
};

export const WORK_GLOSSARY: SourceGlossaryTerm[] = [
  {
    id: "path",
    word: "경로",
    def: "Work서버의 폴더. T: 와 P: 드라이브 안의 자리. 파일과 이미지가 같은 경로를 쓴다."
  },
  {
    id: "file",
    word: "파일",
    def: "폴더 안의 파일 하나. pdf·pptx·이미지·도면이 모두 파일이다."
  },
  {
    id: "doc",
    word: "문서 본문",
    def: "pdf·pptx·xlsx·docx 에서 글을 뽑아 둔 것. 검색은 이 글에서 한다."
  },
  {
    id: "chunk",
    word: "청크",
    def: "본문을 1,000자쯤으로 자른 조각. 검색은 파일 전체가 아니라 이 조각 단위로 찾는다."
  },
  {
    id: "unread",
    word: "못 읽음",
    def: "hwp·도면·암호·손상처럼 글을 못 뽑은 파일. 목록에는 있으나 검색에는 안 잡힌다."
  }
];

export const NOTION_GLOSSARY: SourceGlossaryTerm[] = [
  {
    id: "page",
    word: "페이지",
    def: "노션의 문서 한 장. 「인스파이어 시즌4 제안」 같은 것 하나가 한 페이지다."
  },
  {
    id: "block",
    word: "블록",
    def: "페이지를 이루는 문단·제목·표·목록 한 덩이. 노션이 글을 저장하는 최소 단위다. 페이지 하나에 평균 34개."
  },
  {
    id: "chunk",
    word: "청크",
    def: "블록을 이어붙여 1,000자쯤으로 자른 조각. 검색은 페이지가 아니라 이 조각 단위로 찾는다. 너무 길면 엉뚱한 곳이 걸리고, 너무 짧으면 맥락이 끊긴다."
  },
  {
    id: "embed",
    word: "임베딩",
    def: "청크를 숫자 1,536개로 바꾼 것. 뜻이 비슷하면 숫자도 가까워서, 말이 달라도 찾아낸다. 「미디어파사드」로 물어도 「미디어 외벽」이 나오는 이유다."
  },
  {
    id: "rel",
    word: "관계",
    def: "노션 페이지끼리 이어진 것. 「이 제안에 걸린 회의록 4건」 같은 것. 루나가 2차 데이터를 만들 때 쓴다."
  }
];

export const WIKI_GLOSSARY: SourceGlossaryTerm[] = [
  {
    id: "doc",
    word: "문서",
    def: "위키에 사람이 쓴 글 한 편. 루나가 답을 만들 때 우선해 본다."
  },
  {
    id: "section",
    word: "섹션",
    def: "문서를 나누는 소제목. 한 문서 안에서 주제를 갈라 둔 덩이다."
  }
];

export const GLOSSARY_GLOSSARY: SourceGlossaryTerm[] = [
  {
    id: "term",
    word: "용어",
    def: "회사 안에서 쓰는 말 하나. 검색과 이미지 설명에 같은 말로 맞춘다."
  },
  {
    id: "syn",
    word: "동의어",
    def: "같은 뜻을 가리키는 다른 말. 「미디어파사드」와 「미디어 외벽」처럼."
  },
  {
    id: "cat",
    word: "분류",
    def: "용어가 속한 갈래. 공통·공간처럼 쓰는 자리가 다르다."
  }
];
