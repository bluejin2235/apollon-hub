/** `licenses` 테이블 · LicenseFormModal 계약 유형 */
export type ContractType = "월 구독" | "년 구독" | "영구 라이선스";

/** `licenses` 테이블 · LicenseFormModal 상태 */
export type LicenseStatus = "활성" | "비활성";

/** `licenses` 테이블 · LicenseFormModal 결제 수단 */
export type PaymentMethod = "법인카드" | "계좌이체";

export type ServiceCostType = "월간" | "연간" | "영구";

/**
 * 라이선스 UI에서 쓰는 행 타입.
 * - 대시보드·목록·상세는 주로 `services` 스키마(`plan`, `cost_monthly`, `cost_type` 등)
 * - 폼·`licenses` 테이블은 `plan_name`, `cost`, `contract_type` 등 추가 필드 사용
 */
export type License = {
  id: string;
  name: string;
  plan: string;
  category: string;
  status: string;
  cost_monthly: number;
  /** services DB: 월간/연간/영구. 레거시는 contract_type 없이 이 필드만 채워진 경우가 있음 */
  cost_type: ServiceCostType;
  license_count: number;
  next_renewal: string | null;
  assignee_id: string | null;
  created_at: string;
  updated_at?: string | null;

  plan_name?: string | null;
  currency?: string;
  cost?: number;
  /** services.contract_type — 폼 저장 시 채움. 비어 있으면 cost_type 으로 UI 추론(resolveUiContractType) */
  contract_type?: ContractType;
  /** 라이선스(서비스) 시작일 */
  start_date?: string | null;
  /** 구매일 (년 구독·영구) */
  purchase_date?: string | null;
  /** 라이선스 종료일 = 갱신일 (년 구독, 다음 결제일 앵커) */
  end_date?: string | null;
  /** @deprecated payment_day / payment_month 로 계산. 레거시 컬럼. */
  next_payment_date?: string | null;
  /** 반복 결제일 (월/년 구독 모두). 1~31 */
  payment_day?: number | null;
  /** 반복 결제 월 (년 구독 전용). 1~12 */
  payment_month?: number | null;
  purpose?: string | null;
  payment_method?: PaymentMethod;
  card_holder_id?: string | null;
  website_url?: string | null;
  /** `services.url` (services 테이블 실제 컬럼명, website_url 과 동일 의미) */
  url?: string | null;
  memo?: string | null;
  /** `services.description` (시작일/결제방법/메모 등이 한 줄씩 묶여있는 자유 텍스트) */
  description?: string | null;
};

export type Profile = {
  id: string;
  email: string;
  name: string;
  department: string;
  role: string;
  status: string;
  created_at?: string;
};
