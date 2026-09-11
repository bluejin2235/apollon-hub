import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { getProfileRole } from "@/lib/auth/website-tester";

export async function requireIssueUser(request: NextRequest): Promise<
  | {
      user: User;
      admin: NonNullable<ReturnType<typeof getServiceSupabase>>;
      role: string | null;
      isAdmin: boolean;
    }
  | { error: NextResponse }
> {
  const user = await getApiUser(request);
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return {
      error: NextResponse.json({ error: "Server configuration error" }, { status: 500 })
    };
  }
  const role = await getProfileRole(admin, user.id);
  return {
    user,
    admin,
    role,
    isAdmin: String(role ?? "").trim() === "슈퍼관리자"
  };
}

export function canManageIssueStatus(opts: {
  isAdmin: boolean;
  userId: string;
  authorId: string;
  assigneeId: string | null;
}): boolean {
  if (opts.isAdmin) return true;
  if (opts.authorId === opts.userId) return true;
  return Boolean(opts.assigneeId && opts.assigneeId === opts.userId);
}

export function canAssignIssue(opts: {
  isAdmin: boolean;
  userId: string;
  assigneeId: string | null;
}): boolean {
  if (opts.isAdmin) return true;
  return Boolean(opts.assigneeId && opts.assigneeId === opts.userId);
}

export function canEditIssueContent(opts: {
  isAdmin: boolean;
  userId: string;
  authorId: string;
}): boolean {
  return opts.isAdmin || opts.authorId === opts.userId;
}
