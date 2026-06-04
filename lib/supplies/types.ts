export type SupplyStatus = "available" | "borrowed" | "unavailable";
export type LoanStatus = "active" | "returned";

export type ProfileLite = { id: string; name: string | null; email?: string | null };

export type SupplyLocation = {
  id: string;
  zone_code: string;
  zone_name: string;
  slot_code: string;
  slot_label: string | null;
  is_active: boolean;
  created_at?: string;
};

export type Supply = {
  id: string;
  code: string;
  name: string;
  location_id: string | null;
  quantity: number;
  manager_id: string | null;
  description: string | null;
  components: string | null;
  image_paths: string[];
  status: SupplyStatus;
  created_at: string;
};

export type SupplyWithRelations = Supply & {
  location?: SupplyLocation | null;
  manager?: ProfileLite | null;
};

export type SupplyLoan = {
  id: string;
  supply_id: string;
  borrower_id: string;
  purpose: string;
  due_date: string;
  status: LoanStatus;
  return_image_path: string | null;
  return_note: string | null;
  borrowed_at: string;
  returned_at: string | null;
};

export type SupplyLoanWithRelations = SupplyLoan & {
  borrower?: ProfileLite | null;
};

export type PrintJobWithRequester = {
  id: string;
  created_at: string;
  requester: { name: string | null } | null;
};
