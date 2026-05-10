export type ServiceCostType = "월간" | "연간" | "영구";

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
