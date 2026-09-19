/**
 * 9명 × 15건 개인화 점검 질문
 * 유형: term 3 · project 5 · case 4 · rule 1 · miss 2
 * 같은 팀 2명은 shared 3~4건 겹침
 */

export type QType = "term" | "project" | "case" | "rule" | "miss";

export type PersonaQ = {
  text: string;
  type: QType;
  /** 팀 내 공유 질문 키 — 관점 승격 패턴 확인용 */
  sharedKey?: string;
};

export type PersonaPerson = {
  name: string;
  department: string;
  questions: PersonaQ[];
};

const SPACE_PLAN_SHARED: PersonaQ[] = [
  {
    text: "인스파이어 시즌4 1층에서 2층으로 가는 관람 동선이 어떻게 짜여 있어?",
    type: "project",
    sharedKey: "inspire_s4_flow"
  },
  {
    text: "전주관광타워에서 관람 흐름을 끊지 않게 휴게 공간을 어디에 두는 게 맞아?",
    type: "project",
    sharedKey: "jeonju_rest"
  },
  {
    text: "아폴론에서 「동선」이라고 하면 보통 무엇을 말해?",
    type: "term",
    sharedKey: "term_dongseon"
  },
  {
    text: "수원화성 전시에서 면적 대비 체류 시간을 어떻게 잡았는지 사례 있어?",
    type: "case",
    sharedKey: "suwon_dwell"
  }
];

const SPACE_DESIGN_SHARED: PersonaQ[] = [
  {
    text: "롯데 스타에비뉴 로비 마감재 스펙이 뭐였지?",
    type: "project",
    sharedKey: "lotte_finish"
  },
  {
    text: "광안KCC스위첸 공용부 조명 색온도는 어떻게 가져갔어?",
    type: "project",
    sharedKey: "gwang_an_light"
  },
  {
    text: "아폴론에서 「디테일 도면」은 보통 어디까지를 말해?",
    type: "term",
    sharedKey: "term_detail"
  },
  {
    text: "아크메르 동탄 사인·웨이파인딩 시공 디테일 사례 보여줘",
    type: "case",
    sharedKey: "ark_sign"
  }
];

const VISUAL_SHARED: PersonaQ[] = [
  {
    text: "더후 글로벌 론칭 KV 컬러 팔레트가 뭐였어?",
    type: "project",
    sharedKey: "dehoo_kv"
  },
  {
    text: "인스파이어 시즌4 타이포 레퍼런스 모아둔 거 있어?",
    type: "project",
    sharedKey: "inspire_typo"
  },
  {
    text: "아폴론에서 「KV」라고 하면 보통 무엇을 포함해?",
    type: "term",
    sharedKey: "term_kv"
  },
  {
    text: "성수동2가 프로젝트 모션 가이드 사례 있어?",
    type: "case",
    sharedKey: "seongsu_motion"
  }
];

const CONTENT_PLAN_SHARED: PersonaQ[] = [
  {
    text: "인스파이어 시즌4 메인 내러티브 한 줄로 뭐였지?",
    type: "project",
    sharedKey: "inspire_narrative"
  },
  {
    text: "전주관광타워 체험 시나리오에서 인터랙션 포인트가 어디야?",
    type: "project",
    sharedKey: "jeonju_interact"
  },
  {
    text: "아폴론에서 「IP 활용」이라고 하면 보통 어떤 범위를 말해?",
    type: "term",
    sharedKey: "term_ip"
  },
  {
    text: "수원화성 콘텐츠 흐름을 층별로 나눈 사례 있어?",
    type: "case",
    sharedKey: "suwon_flow"
  }
];

function spacePlanUnique(name: string): PersonaQ[] {
  const a = name === "남은빈";
  return [
    {
      text: a
        ? "「관람 흐름」이랑 「동선」을 우리는 어떻게 구분해?"
        : "「체류 거점」이라는 말, 공간기획에서 보통 어디를 가리켜?",
      type: "term"
    },
    {
      text: a
        ? "「존 구성」이라고 할 때 보통 뭘 정해?"
        : "「면적 배분」할 때 우선 보는 기준이 뭐야?",
      type: "term"
    },
    {
      text: a
        ? "아크메르 동탄 층별 공간 구성표 있어?"
        : "성수동2가 지하~지상 면적 계획 요약 있어?",
      type: "project"
    },
    {
      text: a
        ? "롯데 스타에비뉴 진입부터 코어까지 동선 길이 대략 얼마야?"
        : "더후 글로벌 론칭 팝업 공간 구성은 어떻게 나뉘었어?",
      type: "project"
    },
    {
      text: a
        ? "광안KCC스위첸 모델하우스 관람 순서 사례 있어?"
        : "인스파이어 시즌4랑 비슷한 복합 동선 사례 더 있어?",
      type: "case"
    },
    {
      text: a
        ? "전주관광타워처럼 전망·전시가 겹치는 공간 사례 있어?"
        : "수원화성처럼 역사 공간에 현대 동선을 얹은 사례 있어?",
      type: "case"
    },
    {
      text: a
        ? "아폴론 제안서에서 동선도를 넣을 때 기본 표기 규정이 있어?"
        : "공간기획 산출물 목록에 동선·면적표가 꼭 들어가야 해?",
      type: "rule"
    },
    {
      text: a
        ? "화성시 봉담 비밀연구소 3층 동선 계획서 있어?"
        : "제주 중문 해저터널 관람 동선 최종안 찾아줘",
      type: "miss"
    },
    {
      text: a
        ? "부산 기장 수산물시장 리모델링 면적표 최신본 있어?"
        : "대구 동성로 미디어타워 층별 계획 PDF 어디 있어?",
      type: "miss"
    }
  ];
}

function spaceDesignUnique(name: string): PersonaQ[] {
  const a = name === "김세희";
  return [
    {
      text: a
        ? "「마감재 보드」에 보통 뭘 올려?"
        : "「시공 디테일」이라고 하면 도면 어디까지야?",
      type: "term"
    },
    {
      text: a
        ? "「간접조명」이랑 「다운라이트」를 우리는 어떻게 나눠 써?"
        : "「사인 패밀리」라는 말, 보통 무슨 세트야?",
      type: "term"
    },
    {
      text: a
        ? "인스파이어 시즌4 로비 가구·마감 조합 뭐 썼어?"
        : "전주관광타워 안내데스크 마감·조명 스펙 있어?",
      type: "project"
    },
    {
      text: a
        ? "수원화성 전시 벽체 마감 디테일 도면 있어?"
        : "성수동2가 천장 조명 배치 계획 있어?",
      type: "project"
    },
    {
      text: a
        ? "더후 글로벌 론칭 부스 마감재 레퍼런스 사례 있어?"
        : "인스파이어처럼 대형 사인 시공한 사례 더 있어?",
      type: "case"
    },
    {
      text: a
        ? "아크메르 동탄이랑 비슷한 공용부 조명 사례 있어?"
        : "롯데 스타에비뉴처럼 상업 로비 마감 사례 있어?",
      type: "case"
    },
    {
      text: a
        ? "마감재 승인 받을 때 제출 목록 규정이 있어?"
        : "사인 시공 전 검수 체크리스트 같은 규정 있어?",
      type: "rule"
    },
    {
      text: a
        ? "파주 헤이리 글라스하우스 석재 마감 스펙시트 있어?"
        : "춘천 레고랜드 호텔 로비 조명 계산서 찾아줘",
      type: "miss"
    },
    {
      text: a
        ? "울산 태화강 전망대 난간 디테일 CAD 최신본 어디야?"
        : "세종 정부청사 안내사인 제작 발주서 원본 있어?",
      type: "miss"
    }
  ];
}

function visualUnique(name: string): PersonaQ[] {
  const a = name === "박예림";
  return [
    {
      text: a
        ? "「모션 가이드」에 보통 어떤 항목이 들어가?"
        : "「레퍼런스 보드」랑 「무드보드」를 우리는 어떻게 구분해?",
      type: "term"
    },
    {
      text: a
        ? "「컬러 시스템」이라고 하면 보통 몇 단계까지 정해?"
        : "「타이포 계층」을 잡을 때 기본으로 보는 게 뭐야?",
      type: "term"
    },
    {
      text: a
        ? "롯데 스타에비뉴 시즌 KV 변형본 있어?"
        : "광안KCC스위첸 분양 홍보 모션 소스 있어?",
      type: "project"
    },
    {
      text: a
        ? "전주관광타워 안내 그래픽 컬러 규정 있어?"
        : "아크메르 동탄 브랜드 타이포 적용 사례 있어?",
      type: "project"
    },
    {
      text: a
        ? "더후 KV처럼 글로벌 론칭용 비주얼 사례 더 있어?"
        : "인스파이어 시즌4랑 비슷한 대형 모션 KV 사례 있어?",
      type: "case"
    },
    {
      text: a
        ? "성수동2가처럼 거리형 미디어 타이포 사례 있어?"
        : "수원화성 전시 그래픽 톤앤매너 사례 있어?",
      type: "case"
    },
    {
      text: a
        ? "외부 공개용 KV 파일 네이밍 규정이 있어?"
        : "브랜드 컬러 코드를 문서에 적을 때 표기 규정이 있어?",
      type: "rule"
    },
    {
      text: a
        ? "인천 송도 네오플렉스 2027 KV 원본 PSD 있어?"
        : "강릉 커피거리 미디어파사드 모션 마스터 파일 찾아줘",
      type: "miss"
    },
    {
      text: a
        ? "고양 킨텍스 홀로그램 부스 타이포 가이드 최종본 어디야?"
        : "여수 엑스포기념관 컬러칩 팬톤 대조표 있어?",
      type: "miss"
    }
  ];
}

function contentPlanUnique(name: string): PersonaQ[] {
  const a = name === "김벼리";
  return [
    {
      text: a
        ? "「체험 흐름」이라고 하면 보통 몇 단계로 나눠?"
        : "「시나리오 비트」라는 말, 콘텐츠기획에서 뭐야?",
      type: "term"
    },
    {
      text: a
        ? "「인터랙션 포인트」를 문서에 어떻게 표시해?"
        : "「내러티브 축」을 잡을 때 먼저 정하는 게 뭐야?",
      type: "term"
    },
    {
      text: a
        ? "더후 글로벌 론칭 체험 시나리오 요약 있어?"
        : "롯데 스타에비뉴 콘텐츠 동선 시나리오 있어?",
      type: "project"
    },
    {
      text: a
        ? "아크메르 동탄 주민 커뮤니티 IP 활용안 있어?"
        : "광안KCC스위첸 모델하우스 스토리라인 있어?",
      type: "project"
    },
    {
      text: a
        ? "인스파이어처럼 시즌제 내러티브를 쓴 사례 더 있어?"
        : "전주관광타워처럼 지역 IP를 엮은 콘텐츠 사례 있어?",
      type: "case"
    },
    {
      text: a
        ? "성수동2가 거리 체험 인터랙션 사례 있어?"
        : "수원화성 야간 콘텐츠 시나리오 사례 있어?",
      type: "case"
    },
    {
      text: a
        ? "외부 공개 시나리오에 넣으면 안 되는 항목 규정이 있어?"
        : "IP 사용 시 출처·라이선스를 문서에 남기는 규정이 있어?",
      type: "rule"
    },
    {
      text: a
        ? "평창 알펜시아 스노우뮤지엄 시나리오 최종본 있어?"
        : "목포 해양문화관 인터랙션 큐시트 최신본 찾아줘",
      type: "miss"
    },
    {
      text: a
        ? "진주 촉석루 AR 내러티브 스크립트 원본 어디야?"
        : "통영 동피랑 미디어투어 체험 흐름표 PDF 있어?",
      type: "miss"
    }
  ];
}

function contentPartQuestions(): PersonaQ[] {
  return [
    {
      text: "아폴론에서 「외주 편집」이라고 하면 보통 어디까지야?",
      type: "term"
    },
    {
      text: "「사운드 디자인」이랑 「BGM 선정」을 우리는 어떻게 구분해?",
      type: "term"
    },
    {
      text: "「제작 일정표」에 꼭 들어가는 항목이 뭐야?",
      type: "term"
    },
    {
      text: "인스파이어 시즌4 오프닝 영상 제작 일정 어떻게 잡았어?",
      type: "project"
    },
    {
      text: "더후 글로벌 론칭 영상·사운드 외주 업체 누구였지?",
      type: "project"
    },
    {
      text: "전주관광타워 전시 영상 장비 리스트 있어?",
      type: "project"
    },
    {
      text: "롯데 스타에비뉴 미디어월 콘텐츠 납품 일정 있어?",
      type: "project"
    },
    {
      text: "광안KCC스위첸 분양관 영상 스펙 정리본 있어?",
      type: "project"
    },
    {
      text: "수원화성 야간 영상 매핑 사례처럼 야외 프로젝션 사례 있어?",
      type: "case"
    },
    {
      text: "성수동2가 거리 사운드스케이프 제작 사례 있어?",
      type: "case"
    },
    {
      text: "아크메르 동탄처럼 단지 홍보 영상 외주 돌린 사례 있어?",
      type: "case"
    },
    {
      text: "인스파이어 시즌 영상처럼 시즌제 오프닝을 만든 사례 더 있어?",
      type: "case"
    },
    {
      text: "외주 영상 납품 포맷·코덱 규정이 문서에 있어?",
      type: "rule"
    },
    {
      text: "속초 대포항 드론쇼 원본 편집 프로젝트 파일 있어?",
      type: "miss"
    },
    {
      text: "포항 영일대 워터스크린 사운드 마스터 WAV 최신본 어디야?",
      type: "miss"
    }
  ];
}

function padTo15(shared: PersonaQ[], unique: PersonaQ[], extras: PersonaQ[]): PersonaQ[] {
  const all = [...shared, ...unique, ...extras];
  if (all.length !== 15) {
    throw new Error(`expected 15 got ${all.length}`);
  }
  return all;
}

export const PERSONA_9: PersonaPerson[] = [
  {
    name: "남은빈",
    department: "공간기획팀",
    questions: padTo15(SPACE_PLAN_SHARED, spacePlanUnique("남은빈"), [
      {
        text: "인스파이어 시즌4 전체 관람 예상 소요시간을 어떻게 잡았어?",
        type: "project"
      },
      {
        text: "성수동2가처럼 골목형 동선을 쓴 국내 사례 더 있어?",
        type: "case"
      }
    ])
  },
  {
    name: "성호준",
    department: "공간기획팀",
    questions: padTo15(SPACE_PLAN_SHARED, spacePlanUnique("성호준"), [
      {
        text: "전주관광타워 전망층 체류 유도 장치를 뭐로 했어?",
        type: "project"
      },
      {
        text: "아크메르 동탄처럼 단지 내 커뮤니티 동선 사례 있어?",
        type: "case"
      }
    ])
  },
  {
    name: "김세희",
    department: "공간디자인팀",
    questions: padTo15(SPACE_DESIGN_SHARED, spaceDesignUnique("김세희"), [
      {
        text: "인스파이어 시즌4 계단 난간·조명 디테일 뭐 썼어?",
        type: "project"
      },
      {
        text: "수원화성 전시처럼 역사 공간 마감 절충 사례 있어?",
        type: "case"
      }
    ])
  },
  {
    name: "이준용",
    department: "공간디자인팀",
    questions: padTo15(SPACE_DESIGN_SHARED, spaceDesignUnique("이준용"), [
      {
        text: "전주관광타워 엘리베이터홀 마감·사인 조합 있어?",
        type: "project"
      },
      {
        text: "더후 팝업처럼 단기 설치 마감 사례 더 있어?",
        type: "case"
      }
    ])
  },
  {
    name: "박예림",
    department: "비주얼디자인팀",
    questions: padTo15(VISUAL_SHARED, visualUnique("박예림"), [
      {
        text: "수원화성 전시 그래픽 시스템 컬러 규정 있어?",
        type: "project"
      },
      {
        text: "롯데 스타에비뉴처럼 상업 공간 KV 운영 사례 있어?",
        type: "case"
      }
    ])
  },
  {
    name: "장다혜",
    department: "비주얼디자인팀",
    questions: padTo15(VISUAL_SHARED, visualUnique("장다혜"), [
      {
        text: "아크메르 동탄 단지 사인 그래픽 가이드 있어?",
        type: "project"
      },
      {
        text: "전주관광타워 안내 모션처럼 키오스크 모션 사례 있어?",
        type: "case"
      }
    ])
  },
  {
    name: "김벼리",
    department: "콘텐츠기획팀",
    questions: padTo15(CONTENT_PLAN_SHARED, contentPlanUnique("김벼리"), [
      {
        text: "성수동2가 거리 콘텐츠 캘린더 초안 있어?",
        type: "project"
      },
      {
        text: "롯데 스타에비뉴처럼 상업 공간 스토리텔링 사례 있어?",
        type: "case"
      }
    ])
  },
  {
    name: "김서하",
    department: "콘텐츠기획팀",
    questions: padTo15(CONTENT_PLAN_SHARED, contentPlanUnique("김서하"), [
      {
        text: "광안KCC스위첸 방문 고객 여정 맵 있어?",
        type: "project"
      },
      {
        text: "더후 론칭처럼 브랜드 체험 시나리오 사례 더 있어?",
        type: "case"
      }
    ])
  },
  {
    name: "양진영",
    department: "콘텐츠파트",
    questions: contentPartQuestions()
  }
];

export function assertPersonaBank(): void {
  for (const p of PERSONA_9) {
    if (p.questions.length !== 15) {
      throw new Error(`${p.name} has ${p.questions.length}`);
    }
    const counts: Record<QType, number> = {
      term: 0,
      project: 0,
      case: 0,
      rule: 0,
      miss: 0
    };
    for (const q of p.questions) counts[q.type] += 1;
    if (
      counts.term !== 3 ||
      counts.project !== 5 ||
      counts.case !== 4 ||
      counts.rule !== 1 ||
      counts.miss !== 2
    ) {
      throw new Error(`${p.name} type counts ${JSON.stringify(counts)}`);
    }
  }
}
