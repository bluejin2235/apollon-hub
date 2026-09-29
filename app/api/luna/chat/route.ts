import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { executeLunaChat } from "@/lib/luna/chat-handler";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) return NextResponse.json({error: "Unauthorized"}, {status: 401});
  const admin = getServiceSupabase();
  if (!admin) return NextResponse.json({error: "Server configuration error"}, {status: 500});
  return executeLunaChat(request, {admin, userId: user.id});
}
