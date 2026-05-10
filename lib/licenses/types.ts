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
  cost_type: ServiceCostType;
  license_count: number;
  next_renewal: string | null;
  assignee_id: string | null;
  created_at: string;

  plan_name?: string | null;
  currency?: string;
  cost?: number;
  contract_type?: ContractType;
  start_date?: string | null;
  purpose?: string | null;
  payment_method?: PaymentMethod;
  card_holder_id?: string | null;
  website_url?: string | null;
  memo?: string | null;
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
