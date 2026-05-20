import { addDays, formatISO } from "date-fns";
import { deriveSupplyStatus } from "@/lib/supplies/utils";
import type { Supply } from "@/lib/supplies/types";
import { supabase } from "@/lib/supabase/client";

const SUPPLIES_BUCKET = "supplies";

export async function syncOverdueLoans(): Promise<void> {
  const today = formatISO(new Date(), { representation: "date" });
  await supabase
    .from("supply_loans")
    .update({ status: "overdue" })
    .eq("status", "active")
    .lt("due_date", today)
    .is("returned_at", null);
}

export async function createSupplyNotification(params: {
  userId: string;
  supplyLoanId: string;
  type: string;
  message: string;
}): Promise<void> {
  const { error } = await supabase.from("supply_notifications").insert({
    user_id: params.userId,
    supply_loan_id: params.supplyLoanId,
    type: params.type,
    message: params.message,
    is_read: false
  });
  if (error) console.error("[supplies] notification", error);
}

export async function borrowSupply(params: {
  supply: Supply;
  borrowerId: string;
  purpose: string;
  dueDate: string;
}): Promise<{ error: string | null }> {
  const { supply, borrowerId, purpose, dueDate } = params;
  if (supply.status === "maintenance") return { error: "점검 중인 비품은 대출할 수 없습니다." };
  if (supply.available_qty <= 0) return { error: "대출 가능 수량이 없습니다." };

  const { data: existing } = await supabase
    .from("supply_loans")
    .select("id")
    .eq("supply_id", supply.id)
    .eq("borrower_id", borrowerId)
    .in("status", ["active", "overdue"])
    .limit(1);

  if (existing?.length) return { error: "이미 이 비품을 대출 중입니다." };

  const { data: loan, error: loanErr } = await supabase
    .from("supply_loans")
    .insert({
      supply_id: supply.id,
      borrower_id: borrowerId,
      purpose: purpose.trim(),
      due_date: dueDate,
      status: "active"
    })
    .select("id")
    .single();

  if (loanErr || !loan) {
    console.error("[supplies] borrow", loanErr);
    return { error: loanErr?.message ?? "대출 신청에 실패했습니다." };
  }

  const newAvailable = Math.max(0, supply.available_qty - 1);
  const newStatus = deriveSupplyStatus(newAvailable, supply.quantity, supply.status);

  const { error: supplyErr } = await supabase
    .from("supplies")
    .update({ available_qty: newAvailable, status: newStatus })
    .eq("id", supply.id);

  if (supplyErr) {
    console.error("[supplies] supply update", supplyErr);
    return { error: supplyErr.message };
  }

  if (supply.manager_id) {
    await createSupplyNotification({
      userId: supply.manager_id,
      supplyLoanId: loan.id,
      type: "loan_created",
      message: `${supply.name}(${supply.code}) 대출 신청이 등록되었습니다.`
    });
  }

  await createSupplyNotification({
    userId: borrowerId,
    supplyLoanId: loan.id,
    type: "loan_confirmed",
    message: `${supply.name} 대출이 완료되었습니다. 반납예정일: ${dueDate}`
  });

  return { error: null };
}

export async function uploadReturnImage(loanId: string, file: File): Promise<{ url: string | null; error: string | null }> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `returns/${loanId}/${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from(SUPPLIES_BUCKET).upload(path, file, { upsert: false });
  if (upErr) {
    console.error("[supplies] return upload", upErr);
    return { url: null, error: upErr.message };
  }
  const { data } = supabase.storage.from(SUPPLIES_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

export async function returnSupplyLoan(params: {
  loanId: string;
  returnImageUrl: string;
  note?: string | null;
}): Promise<{ error: string | null }> {
  const { loanId, returnImageUrl, note } = params;

  const { data: loan, error: loanFetchErr } = await supabase
    .from("supply_loans")
    .select("*, supply:supplies(*)")
    .eq("id", loanId)
    .single();

  if (loanFetchErr || !loan) {
    return { error: loanFetchErr?.message ?? "대출 정보를 찾을 수 없습니다." };
  }

  if (loan.returned_at) return { error: null };

  const supply = loan.supply as Supply | null;
  if (!supply) return { error: "비품 정보를 찾을 수 없습니다." };

  const now = new Date().toISOString();
  const { error: loanErr } = await supabase
    .from("supply_loans")
    .update({
      returned_at: now,
      status: "returned",
      return_image_url: returnImageUrl,
      note: note?.trim() || null
    })
    .eq("id", loanId);

  if (loanErr) return { error: loanErr.message };

  const newAvailable = Math.min(supply.quantity, supply.available_qty + 1);
  const newStatus = deriveSupplyStatus(newAvailable, supply.quantity, supply.status);

  const { error: supplyErr } = await supabase
    .from("supplies")
    .update({ available_qty: newAvailable, status: newStatus })
    .eq("id", supply.id);

  if (supplyErr) return { error: supplyErr.message };
  return { error: null };
}

export async function uploadSupplyImage(supplyId: string, file: File): Promise<{ url: string | null; error: string | null }> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${supplyId}/${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from(SUPPLIES_BUCKET).upload(path, file, { upsert: true });
  if (upErr) {
    console.error("[supplies] upload", upErr);
    return { url: null, error: upErr.message };
  }
  const { data } = supabase.storage.from(SUPPLIES_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

export async function deleteSupply(supplyId: string): Promise<{ error: string | null }> {
  const { error: loansErr } = await supabase
    .from("supply_loans")
    .delete()
    .eq("supply_id", supplyId);
  if (loansErr) return { error: loansErr.message };

  await supabase.from("supply_items").delete().eq("supply_id", supplyId);

  const { error } = await supabase.from("supplies").delete().eq("id", supplyId);
  return { error: error?.message ?? null };
}

export function defaultDueDate(days = 7): string {
  return formatISO(addDays(new Date(), days), { representation: "date" });
}
