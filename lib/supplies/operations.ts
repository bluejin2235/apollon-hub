import { supabase } from "@/lib/supabase/client";

async function sumActiveLoanQuantity(
  supplyId: string
): Promise<{ sum: number; error: string | null }> {
  const { data, error } = await supabase
    .from("supply_loans")
    .select("loan_quantity")
    .eq("supply_id", supplyId)
    .eq("status", "active");

  if (error) return { sum: 0, error: error.message };

  const sum = (data ?? []).reduce(
    (acc, row) => acc + (Number((row as { loan_quantity?: number }).loan_quantity) || 0),
    0
  );
  return { sum, error: null };
}

function computeSupplyStatus(
  supplyQuantity: number,
  activeBorrowedSum: number
): "available" | "partially_borrowed" | "borrowed" {
  if (activeBorrowedSum <= 0) return "available";
  if (activeBorrowedSum >= supplyQuantity) return "borrowed";
  return "partially_borrowed";
}

export async function getAvailableQuantity(supplyId: string): Promise<number> {
  const { data: supply, error } = await supabase
    .from("supplies")
    .select("quantity")
    .eq("id", supplyId)
    .maybeSingle();

  if (error || !supply) return 0;

  const { sum, error: sumErr } = await sumActiveLoanQuantity(supplyId);
  if (sumErr) return 0;

  return Math.max(0, Number(supply.quantity) - sum);
}

export async function createSupply(params: {
  name: string;
  locationId: string;
  quantity: number;
  managerId: string | null;
  description: string | null;
  components: string | null;
  imagePaths: string[];
}): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from("supplies")
    .insert({
      name: params.name.trim(),
      location_id: params.locationId,
      quantity: params.quantity,
      manager_id: params.managerId,
      description: params.description?.trim() || null,
      components: params.components?.trim() || null,
      image_paths: params.imagePaths,
      status: "available"
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[supplies] create", error);
    return { id: null, error: error?.message ?? "등록 실패" };
  }
  return { id: data.id as string, error: null };
}

export async function updateSupply(params: {
  supplyId: string;
  name: string;
  locationId: string;
  quantity: number;
  managerId: string | null;
  description: string | null;
  components: string | null;
}): Promise<{ code: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc("update_supply_details", {
    p_supply_id: params.supplyId,
    p_name: params.name.trim(),
    p_location_id: params.locationId,
    p_quantity: params.quantity,
    p_manager_id: params.managerId,
    p_description: params.description?.trim() || null,
    p_components: params.components?.trim() || null
  });

  if (error) {
    console.error("[supplies] update", error);
    return { code: null, error: error.message };
  }

  return { code: data as string, error: null };
}

export async function borrowSupply(params: {
  supplyId: string;
  borrowerId: string;
  purpose: string;
  dueDate: string;
  loanQuantity?: number;
  loanComponents?: string | null;
}): Promise<{ error: string | null }> {
  const loanQuantity = Math.max(1, params.loanQuantity ?? 1);
  const loanComponents = params.loanComponents?.trim() || null;

  const { data: supply, error: sErr } = await supabase
    .from("supplies")
    .select("id, status, quantity")
    .eq("id", params.supplyId)
    .maybeSingle();

  if (sErr || !supply) return { error: "물품을 찾을 수 없습니다." };

  const status = supply.status as string;
  if (status !== "available" && status !== "partially_borrowed") {
    return { error: "대출할 수 없는 상태입니다." };
  }

  const { sum: activeSum, error: sumErr } = await sumActiveLoanQuantity(params.supplyId);
  if (sumErr) return { error: sumErr };

  const supplyQuantity = Number(supply.quantity) || 0;
  const availableQty = supplyQuantity - activeSum;
  if (loanQuantity > availableQty) {
    return { error: `대출 가능 수량(${availableQty})을 초과했습니다.` };
  }

  const { error: loanErr } = await supabase.from("supply_loans").insert({
    supply_id: params.supplyId,
    borrower_id: params.borrowerId,
    purpose: params.purpose.trim(),
    due_date: params.dueDate,
    status: "active",
    loan_quantity: loanQuantity,
    loan_components: loanComponents
  });

  if (loanErr) {
    console.error("[supplies] borrow", loanErr);
    return { error: loanErr.message };
  }

  const nextActiveSum = activeSum + loanQuantity;
  const nextStatus = computeSupplyStatus(supplyQuantity, nextActiveSum);

  const { error: upErr } = await supabase
    .from("supplies")
    .update({ status: nextStatus })
    .eq("id", params.supplyId);

  if (upErr) return { error: upErr.message };
  return { error: null };
}

export async function returnSupply(params: {
  loanId: string;
  supplyId: string;
  returnImagePath: string;
  returnNote: string | null;
  returnQuantity?: number;
  returnComponents?: string | null;
}): Promise<{ error: string | null }> {
  const now = new Date().toISOString();

  const { data: loan, error: lErr } = await supabase
    .from("supply_loans")
    .select(
      "id, supply_id, borrower_id, purpose, due_date, status, loan_quantity, loan_components, borrowed_at"
    )
    .eq("id", params.loanId)
    .maybeSingle();

  if (lErr || !loan) return { error: "대출 기록을 찾을 수 없습니다." };
  if (loan.status !== "active") return { error: "이미 반납된 대출입니다." };

  const loanQty = Math.max(1, Number(loan.loan_quantity) || 1);
  const returnQty = Math.max(1, params.returnQuantity ?? loanQty);
  const returnComponents = params.returnComponents?.trim() || null;

  if (returnQty > loanQty) {
    return { error: `반납 수량(${returnQty})이 대출 수량(${loanQty})을 초과합니다.` };
  }

  const supplyId = (loan.supply_id as string) || params.supplyId;

  if (returnQty < loanQty) {
    const { error: reduceErr } = await supabase
      .from("supply_loans")
      .update({ loan_quantity: loanQty - returnQty })
      .eq("id", params.loanId);

    if (reduceErr) return { error: reduceErr.message };

    const { error: insertErr } = await supabase.from("supply_loans").insert({
      supply_id: loan.supply_id,
      borrower_id: loan.borrower_id,
      purpose: loan.purpose,
      due_date: loan.due_date,
      status: "returned",
      loan_quantity: returnQty,
      loan_components: returnComponents,
      return_image_path: params.returnImagePath,
      return_note: params.returnNote?.trim() || null,
      borrowed_at: loan.borrowed_at as string,
      returned_at: now
    });

    if (insertErr) {
      console.error("[supplies] partial return insert", insertErr);
      return { error: insertErr.message };
    }
  } else {
    const { error: loanErr } = await supabase
      .from("supply_loans")
      .update({
        status: "returned",
        return_image_path: params.returnImagePath,
        return_note: params.returnNote?.trim() || null,
        returned_at: now,
        ...(returnComponents ? { loan_components: returnComponents } : {})
      })
      .eq("id", params.loanId);

    if (loanErr) return { error: loanErr.message };
  }

  const { data: supply, error: sErr } = await supabase
    .from("supplies")
    .select("quantity")
    .eq("id", supplyId)
    .maybeSingle();

  if (sErr || !supply) return { error: "물품을 찾을 수 없습니다." };

  const { sum: activeSum, error: sumErr } = await sumActiveLoanQuantity(supplyId);
  if (sumErr) return { error: sumErr };

  const nextStatus = computeSupplyStatus(Number(supply.quantity) || 0, activeSum);

  const { error: upErr } = await supabase
    .from("supplies")
    .update({ status: nextStatus })
    .eq("id", supplyId);

  if (upErr) return { error: upErr.message };
  return { error: null };
}

export async function deleteSupply(supplyId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("supplies").delete().eq("id", supplyId);

  if (error) {
    console.error("[supplies] delete", error);
    return { error: error.message };
  }
  return { error: null };
}

export async function getActiveLoanForUser(
  supplyId: string,
  userId: string
): Promise<{
  id: string;
  purpose: string;
  due_date: string;
  borrowed_at: string;
  loan_quantity: number;
  loan_components: string | null;
} | null> {
  const { data } = await supabase
    .from("supply_loans")
    .select("id, purpose, due_date, borrowed_at, loan_quantity, loan_components")
    .eq("supply_id", supplyId)
    .eq("borrower_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id as string,
    purpose: data.purpose as string,
    due_date: data.due_date as string,
    borrowed_at: data.borrowed_at as string,
    loan_quantity: Number(data.loan_quantity) || 1,
    loan_components: (data.loan_components as string | null) ?? null
  };
}
