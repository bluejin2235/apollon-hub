import type { Supply } from "@/lib/supplies/types";
import { supabase } from "@/lib/supabase/client";

/** 비품 INSERT RLS 디버깅 — 개발 환경에서만 브라우저 콘솔 출력 */
export async function logSupplyInsertAuthDebug(): Promise<void> {
  if (process.env.NODE_ENV !== "development") return;

  const {
    data: { session },
    error: sessionError
  } = await supabase.auth.getSession();

  const authUserId = session?.user?.id ?? null;
  const authEmail = session?.user?.email ?? null;

  let profile: { id: string; role: string; email: string; name: string } | null = null;
  let profileError: string | null = null;

  if (authUserId) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, role, email, name")
      .eq("id", authUserId)
      .maybeSingle();

    if (error) {
      profileError = error.message;
    } else if (data) {
      profile = {
        id: data.id as string,
        role: String(data.role),
        email: data.email as string,
        name: data.name as string
      };
    }
  }

  const { data: isManager, error: rpcError } = await supabase.rpc("is_supply_manager");

  console.group("[supplies] INSERT auth debug (등록 직전)");
  console.log("auth.uid (session user id):", authUserId);
  console.log("auth email:", authEmail);
  if (sessionError) console.log("session error:", sessionError.message);
  if (profileError) console.log("profiles 조회 error:", profileError);
  console.log("profiles row:", profile);
  console.log("profiles.role (raw):", profile?.role ?? "(없음)");
  console.log("profiles.role type:", profile ? typeof profile.role : "n/a");
  console.log("auth.uid === profiles.id:", authUserId != null && profile != null ? authUserId === profile.id : false);
  console.log("is_supply_manager() RPC:", isManager, typeof isManager);
  if (rpcError) console.log("is_supply_manager RPC error:", rpcError.message, rpcError);
  console.log("클라이언트 기대 관리자 role:", profile?.role === "슈퍼관리자" || profile?.role === "중간관리자");
  console.groupEnd();
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
  await logSupplyInsertAuthDebug();

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

  if (sErr || !supply) return { error: "비품을 찾을 수 없습니다." };
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
