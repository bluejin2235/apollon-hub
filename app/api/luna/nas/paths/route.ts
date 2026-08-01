import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";

export const runtime = "nodejs";

type ImportantPathRow = {
  id: string;
  drive: string;
  path: string;
  note: string | null;
  created_at: string;
};

async function requireSuperAdmin(request: NextRequest) {
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
  if (!(await isSuperAdminUser(admin, user))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user, admin };
}

function parseDrivePathLine(
  raw: string
): { drive: string; path: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const withDrive = trimmed.match(/^([A-Za-z]):[/\\](.*)$/);
  if (withDrive) {
    const drive = withDrive[1]!.toUpperCase();
    const path = withDrive[2]!.replace(/\//g, "\\").replace(/^\\+/, "").trim();
    if (!path) return null;
    return { drive, path };
  }

  return null;
}

function drivePathKey(drive: string, path: string): string {
  return `${drive.trim().toUpperCase()}\0${path}`;
}

const PATH_IN_CHUNK = 15;

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  const { data, error } = await admin
    .from("nas_important_paths")
    .select("id, drive, path, note, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[luna/nas/paths] GET", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as ImportantPathRow[];
  if (rows.length === 0) {
    console.log("[luna/nas/paths] rows", 0, "matched", 0);
    return NextResponse.json({ paths: [] });
  }

  const pathList = Array.from(new Set(rows.map((r) => r.path).filter(Boolean)));
  const foundSet = new Set<string>();
  let foundCount = 0;

  // .in() URL 길이 제한(Headers Overflow) 회피: path를 청크로 나눠 정확 일치 조회
  for (let i = 0; i < pathList.length; i += PATH_IN_CHUNK) {
    const chunk = pathList.slice(i, i + PATH_IN_CHUNK);
    const { data: found, error: foundError } = await admin
      .from("nas_directory")
      .select("drive, path")
      .in("path", chunk);

    if (foundError) {
      console.error("[luna/nas/paths] match", foundError);
      // 매칭 실패해도 원본 목록은 반환 (matched: false)
      break;
    }

    foundCount += found?.length ?? 0;
    for (const row of found ?? []) {
      const drive = typeof row.drive === "string" ? row.drive : "";
      const path = typeof row.path === "string" ? row.path : "";
      if (!path) continue;
      foundSet.add(drivePathKey(drive, path));
    }
  }

  console.log("[luna/nas/paths] rows", rows.length, "matched", foundCount);

  return NextResponse.json({
    paths: rows.map((row) => ({
      ...row,
      matched: foundSet.has(drivePathKey(row.drive, row.path))
    }))
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  let body: {
    drive?: string;
    path?: string;
    note?: string;
    bulk?: string[];
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const toInsert: { drive: string; path: string; note?: string | null }[] = [];

  if (Array.isArray(body.bulk)) {
    for (const line of body.bulk) {
      if (typeof line !== "string") continue;
      const parsed = parseDrivePathLine(line);
      if (parsed) toInsert.push(parsed);
    }
  } else {
    let drive =
      typeof body.drive === "string" ? body.drive.trim().toUpperCase() : "";
    let path = typeof body.path === "string" ? body.path.trim() : "";

    const fromPath = parseDrivePathLine(path);
    if (fromPath) {
      drive = fromPath.drive;
      path = fromPath.path;
    } else {
      path = path.replace(/\//g, "\\").replace(/^\\+/, "");
      // strip leading "T:\" if pasted into path only
      const stripped = parseDrivePathLine(`${drive}:\\${path}`);
      if (stripped && drive) {
        path = stripped.path;
      }
    }

    if (!drive || !path) {
      return NextResponse.json(
        { error: "drive and path are required" },
        { status: 400 }
      );
    }
    toInsert.push({
      drive,
      path,
      note: typeof body.note === "string" ? body.note : null
    });
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ error: "No valid paths" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("nas_important_paths")
    .insert(toInsert)
    .select("id, drive, path, note, created_at");

  if (error) {
    console.error("[luna/nas/paths] POST", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ inserted: data?.length ?? 0, paths: data ?? [] });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  let body: { id?: string };
  try {
    body = (await request.json()) as { id?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { error } = await admin.from("nas_important_paths").delete().eq("id", id);
  if (error) {
    console.error("[luna/nas/paths] DELETE", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
