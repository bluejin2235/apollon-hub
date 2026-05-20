export type SupplyStatus = "available" | "borrowed" | "maintenance";
export type LoanStatus = "active" | "returned" | "overdue";
export type ItemStatus = "normal" | "lost" | "damaged";
export type NotificationType = string;

export type ProfileLite = { id: string; name: string | null; email?: string | null };

export type Supply = {
  id: string;
  code: string;
  name: string;
  category: string;
  location: string;
  description: string | null;
  manager_id: string | null;
  status: SupplyStatus;
  quantity: number;
  available_qty: number;
  image_url: string | null;
  created_at: string;
};

export type SupplyItem = {
  id: string;
  supply_id: string;
  item_name: string;
  quantity: number;
  status: ItemStatus;
};

export type SupplyLoan = {
  id: string;
  supply_id: string;
  borrower_id: string;
  purpose: string | null;
  borrowed_at: string;
  due_date: string;
  returned_at: string | null;
  status: LoanStatus;
  note: string | null;
  return_image_url: string | null;
};

export type SupplyLoanWithRelations = SupplyLoan & {
  supply?: Pick<Supply, "id" | "code" | "name" | "category" | "location"> | null;
  borrower?: ProfileLite | null;
};

export type SupplyWithManager = Supply & {
  manager?: ProfileLite | null;
};

export type SupplyCardData = SupplyWithManager & {
  activeDueDate?: string | null;
  activeBorrowerName?: string | null;
};

export type SupplyNotification = {
  id: string;
  user_id: string;
  supply_loan_id: string | null;
  type: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

export const ZONE_FILTERS = ["전체", "A", "B", "C", "D", "E", "F", "1", "2", "3", "4"] as const;
export const STATUS_FILTERS = ["전체", "대출가능", "대출중", "점검중"] as const;

export type ZoneFilter = (typeof ZONE_FILTERS)[number];
export type StatusFilterLabel = (typeof STATUS_FILTERS)[number];
