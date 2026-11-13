/**
 * 화면에 보이는 이름만 한글로 바꾼다. 데이터 값(key)은 그대로 둔다.
 * 표에 없는 값은 원래 이름을 그대로 보여 준다.
 */

/** GA4 기본 채널 그룹 — 영문 고정값이다 */
const CHANNEL_LABEL: Record<string, string> = {
  "Organic Search": "검색",
  Direct: "직접",
  Referral: "추천",
  "Organic Social": "SNS",
  "Paid Search": "유료 검색",
  "Paid Social": "SNS 광고",
  "Organic Video": "동영상",
  "AI Assistant": "AI",
  Email: "이메일",
  Unassigned: "미분류",
  "(other)": "기타"
};

export function channelLabel(name: string): string {
  return CHANNEL_LABEL[name] ?? name;
}

/** GA4 country 는 영어 이름으로 온다. 지금 데이터에 나오는 나라만 둔다 */
const COUNTRY_LABEL: Record<string, string> = {
  "(not set)": "알 수 없음",
  Albania: "알바니아",
  Algeria: "알제리",
  Australia: "호주",
  Austria: "오스트리아",
  Azerbaijan: "아제르바이잔",
  Bangladesh: "방글라데시",
  Belgium: "벨기에",
  Brazil: "브라질",
  Cambodia: "캄보디아",
  Canada: "캐나다",
  China: "중국",
  Cyprus: "키프로스",
  Denmark: "덴마크",
  "Dominican Republic": "도미니카 공화국",
  Egypt: "이집트",
  Ethiopia: "에티오피아",
  Finland: "핀란드",
  France: "프랑스",
  Georgia: "조지아",
  Germany: "독일",
  Greece: "그리스",
  Guam: "괌",
  "Hong Kong": "홍콩",
  Hungary: "헝가리",
  India: "인도",
  Indonesia: "인도네시아",
  Iran: "이란",
  Iraq: "이라크",
  Ireland: "아일랜드",
  "Isle of Man": "맨섬",
  Israel: "이스라엘",
  Italy: "이탈리아",
  Jamaica: "자메이카",
  Japan: "일본",
  Jordan: "요르단",
  Kazakhstan: "카자흐스탄",
  Kosovo: "코소보",
  Latvia: "라트비아",
  Lebanon: "레바논",
  Libya: "리비아",
  Lithuania: "리투아니아",
  Luxembourg: "룩셈부르크",
  Macao: "마카오",
  Malaysia: "말레이시아",
  Malta: "몰타",
  Mauritius: "모리셔스",
  Mexico: "멕시코",
  Monaco: "모나코",
  Mongolia: "몽골",
  Morocco: "모로코",
  Nepal: "네팔",
  Netherlands: "네덜란드",
  "New Zealand": "뉴질랜드",
  Nigeria: "나이지리아",
  "North Macedonia": "북마케도니아",
  "Northern Mariana Islands": "북마리아나 제도",
  Norway: "노르웨이",
  Pakistan: "파키스탄",
  Peru: "페루",
  Philippines: "필리핀",
  Poland: "폴란드",
  Portugal: "포르투갈",
  Qatar: "카타르",
  Romania: "루마니아",
  Russia: "러시아",
  "Saudi Arabia": "사우디아라비아",
  Serbia: "세르비아",
  Seychelles: "세이셸",
  Singapore: "싱가포르",
  "South Africa": "남아프리카 공화국",
  "South Korea": "한국",
  Spain: "스페인",
  Sweden: "스웨덴",
  Switzerland: "스위스",
  Taiwan: "대만",
  Thailand: "태국",
  "Türkiye": "튀르키예",
  Turkey: "튀르키예",
  Ukraine: "우크라이나",
  "United Arab Emirates": "아랍에미리트",
  "United Kingdom": "영국",
  "United States": "미국",
  Uzbekistan: "우즈베키스탄",
  Venezuela: "베네수엘라",
  Vietnam: "베트남"
};

let regionNames: Intl.DisplayNames | null | undefined;

function regionName(code: string): string | null {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames("ko", { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  if (!regionNames) return null;
  try {
    const name = regionNames.of(code);
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}

/**
 * 서치 콘솔 country 는 소문자 세 글자 코드(kor)로 온다.
 * 영어 이름으로 바꿔 COUNTRY_LABEL 을 함께 쓴다. 지금 데이터에 나오는 코드만 둔다.
 */
const ALPHA3_COUNTRY: Record<string, string> = {
  are: "United Arab Emirates",
  aus: "Australia",
  bel: "Belgium",
  bgd: "Bangladesh",
  bra: "Brazil",
  che: "Switzerland",
  chn: "China",
  cyp: "Cyprus",
  deu: "Germany",
  dnk: "Denmark",
  dom: "Dominican Republic",
  egy: "Egypt",
  esp: "Spain",
  fra: "France",
  gbr: "United Kingdom",
  grc: "Greece",
  hkg: "Hong Kong",
  idn: "Indonesia",
  ind: "India",
  isr: "Israel",
  ita: "Italy",
  kor: "South Korea",
  lby: "Libya",
  mkd: "North Macedonia",
  nor: "Norway",
  per: "Peru",
  prt: "Portugal",
  sau: "Saudi Arabia",
  tha: "Thailand",
  tur: "Türkiye",
  usa: "United States",
  vnm: "Vietnam"
};

/**
 * 두 글자 국가 코드(KR)면 Intl 로, 세 글자 코드(kor)·영어 이름이면 표로,
 * 어느 쪽에도 없으면 그대로
 */
export function countryLabel(name: string): string {
  if (/^[A-Za-z]{2}$/.test(name)) return regionName(name.toUpperCase()) ?? name;
  if (/^[A-Za-z]{3}$/.test(name)) {
    const english = ALPHA3_COUNTRY[name.toLowerCase()];
    return (english && COUNTRY_LABEL[english]) || name;
  }
  return COUNTRY_LABEL[name] ?? name;
}

/** GA4 deviceCategory(desktop) · 서치 콘솔 device(DESKTOP) 모두 대소문자만 다르다 */
const DEVICE_LABEL: Record<string, string> = {
  desktop: "데스크톱",
  mobile: "모바일",
  tablet: "태블릿",
  "smart tv": "TV"
};

export function deviceLabel(name: string): string {
  return DEVICE_LABEL[name.toLowerCase()] ?? name;
}
