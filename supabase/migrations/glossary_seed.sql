-- 용어사전 시드 데이터 (schema, rpc 마이그레이션 실행 이후에 적용)
-- 공통 용어 8 + 최초 버전 이력 + 지식 후보 3

insert into public.glossary_terms (term_ko,term_en,term_zh,term_zh_pron,category,definition) values
('감리','Supervision','监理','지엔리','common','우리 업무의 감리는 인테리어(시공) 감리와 기술감리로 구분된다. 시공감리는 현장 담당자와 협업해 청사진(고객 컨펌 최종 실시설계도면) 기준으로 시공되도록 모니터링·지원하고 이슈 시 고객사·SV에게 보고한다. 기술감리는 HW 기술감리로, 청사진 기준 HW 설치를 위해 현장소장·HW 외주업체를 모니터링·지원·보고한다.'),
('검수','Inspection','验收','옌셔우','common','고객에게 중도금·잔금을 요청하기 위한 중요한 과정으로, 완료 시점 검수가 가장 중요하고 어렵다. 계약서·수행계획서 등 합의된 목표·범위 기준으로 산출물을 대조·확인·승인하며, 완료 시 검수확인서에 고객 서명을 받고 비용을 청구한다.'),
('견적서','Quotation','报价单','바오지아딴','common','일 진행에 발생하는 비용을 예상해 계산한 내역 문서. 아직 발생하지 않은 거래의 경비·예상비용을 산출해 예산 편성의 기초 자료로 쓴다. 디스트릭트는 표준견적서로 견적을 확정한다.'),
('계약서','Contract','合同','허퉁','common','계약 당사자 간 의사표시에 따른 법률행위를 문서화한 것. 업무 R&R, 산출물, 일정, 범위 등이 상세히 기록되며 분쟁 시 기준이 된다.'),
('기본설계','Basic Design','初步设计','추뿌셔지','common','계획설계와 실시설계의 중간 단계. 구체적 치수를 표기하고 인테리어 마감재를 선정한다. 배치도·평면도·입면도·단면도·재료마감표·설비도 등을 포함하며, 컨펌 후 이를 기준으로 시공견적을 산정해 계약 협의에 들어간다.'),
('킥오프 미팅','Kick-off Meeting','启动会议','치똥후이이','common','공식적인 프로젝트의 첫 업무. 이 시점 이후 비용·업무시간은 프로젝트 코드로 관리한다. 원칙적으로 계약 완료·선금 수금 확인 시점에 진행하며, BD가 사업개발 정보를 SV·TF에 이관하는 공식 과정이다.'),
('마스터플랜','Master Plan','项目规划设计','샹무꾸이화셔지','common','중국의 테마파크·전시처럼 여러 분야(컨텐츠·HW·인테리어·운영)의 기획·설계를 함께 하는 업무. 전체 컨셉부터 분야별 실시설계까지를 뜻하며, 완료 후 이를 기준으로 Implementation 단계를 진행한다.'),
('청사진','Blueprint','蓝图','란투','common','설계도 복사에 쓰이던 방법(도면). 한국은 CAD 출력으로 대체됐으나, 중국은 도면 검수용으로 청사진 제출이 관례적으로 요구된다. 내부에서는 ''고객 컨펌 최종 실시설계도면''의 의미로도 쓴다.');

-- 시드 용어의 최초 버전 이력
insert into public.glossary_versions (term_id,version,term_ko,term_en,term_zh,term_zh_pron,definition,editor_type,editor_name,change_note)
select id,1,term_ko,term_en,term_zh,term_zh_pron,definition,'human','디스트릭트 Glossary Book','최초 이관'
from public.glossary_terms;

-- 지식 후보 3건
insert into public.glossary_candidates (term_ko,term_en,term_zh,category,definition_draft,source_note) values
('GX 프로젝트','GX Project',null,'common','(초안) 몰입형 대공간 그래픽 익스피리언스 프로젝트를 지칭하는 내부 약어. 정확한 범위·기준은 검토 필요.','김OO 매니저 확인 (2026-08-11) “GX가 무슨 뜻이에요?”'),
('안정화','Stabilization','设备稳定化','common','(초안) 현장 설치 완료 후 HW·SW가 오류 없이 지속 구동되는지 일정 기간 점검·조정하는 단계.','이OO 엔지니어 답변 (2026-08-10)'),
('렙업','Wrap-up','项目总结报告','common','(초안) 프로젝트 종료 시 초기 목표 기준으로 과정·결과를 TF원과 정리하고 후속 개선 방향을 도출하는 활동.','박OO PM 답변 (2026-08-09)');
