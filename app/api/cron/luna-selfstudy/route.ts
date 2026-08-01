import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  pickSelfstudyTopics,
  runSelfstudyQueueItem
} from "@/lib/luna/selfstudy";

export const runtime = "nodejs";
export const maxDuration = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[luna-selfstudy] CRON_SECRET is not configured");
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  try {
    const pick = await pickSelfstudyTopics(admin);

    const { data: pending } = await admin
      .from("luna_selfstudy_queue")
      .select("id")
      .eq("status", "pending")
      .order("score", { ascending: false })
      .limit(3);

    const runs: Array<{ report_id: string; queue_id: string; topic: string }> =
      [];
    const ids = (pending ?? []).map((r) => r.id as string);

    for (let i = 0; i < ids.length; i += 1) {
      if (i > 0) await sleep(5000);
      try {
        const result = await runSelfstudyQueueItem(admin, ids[i]!);
        runs.push(result);
      } catch (err) {
        console.error("[luna-selfstudy] run one", ids[i], err);
      }
    }

    console.log("[luna-selfstudy] cron", {
      picked: pick.picked,
      ran: runs.length
    });
    return NextResponse.json({ pick, runs });
  } catch (err) {
    console.error("[luna-selfstudy]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Selfstudy failed" },
      { status: 500 }
    );
  }
}
