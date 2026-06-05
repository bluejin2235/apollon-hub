import { supabase } from "@/lib/supabase/client";

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
}): Promise<{ error: string | null }> {
  const { data: supply, error: sErr } = await supabase
    .from("supplies")
    .select("id, status")
    .eq("id", params.supplyId)
    .maybeSingle();

  if (sErr || !supply) return { error: "물품을 찾을 수 없습니다." };
  if (supply.status !== "available") return { error: "대출할 수 없는 상태입니다." };

  const { error: loanErr } = await supabase.from("supply_loans").insert({
    supply_id: params.supplyId,
    borrower_id: params.borrowerId,
    purpose: params.purpose.trim(),
    due_date: params.dueDate,
    status: "active"
  });

  if (loanErr) {
    console.error("[supplies] borrow", loanErr);
    return { error: loanErr.message };
  }

  const { error: upErr } = await supabase
    .from("supplies")
    .update({ status: "borrowed" })
    .eq("id", params.supplyId);

  if (upErr) return { error: upErr.message };
  return { error: null };
}

export async function returnSupply(params: {
  loanId: string;
  supplyId: string;
  returnImagePath: string;
  returnNote: string | null;
}): Promise<{ error: string | null }> {
  const now = new Date().toISOString();
  const { error: loanErr } = await supabase
    .from("supply_loans")
    .update({
      status: "returned",
      return_image_path: params.returnImagePath,
      return_note: params.returnNote?.trim() || null,
      returned_at: now
    })
    .eq("id", params.loanId);

  if (loanErr) return { error: loanErr.message };

  const { error: sErr } = await supabase
    .from("supplies")
    .update({ status: "available" })
    .eq("id", params.supplyId);

  if (sErr) return { error: sErr.message };
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
): Promise<{ id: string; purpose: string; due_date: string; borrowed_at: string } | null> {
  const { data } = await supabase
    .from("supply_loans")
    .select("id, purpose, due_date, borrowed_at")
    .eq("supply_id", supplyId)
    .eq("borrower_id", userId)
    .eq("status", "active")
    .maybeSingle();

  return data as { id: string; purpose: string; due_date: string; borrowed_at: string } | null;
}
