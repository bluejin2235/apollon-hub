import { supabase } from "@/lib/supabase/client";

const BUCKET = "supply-images";

export async function uploadSupplyImages(supplyId: string, files: File[]): Promise<{ paths: string[]; error: string | null }> {
  const paths: string[] = [];
  for (const file of files) {
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${supplyId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
    if (error) {
      console.error("[supply-images] upload", error);
      return { paths, error: error.message };
    }
    paths.push(path);
  }
  return { paths, error: null };
}

export async function uploadReturnImage(supplyId: string, loanId: string, file: File): Promise<{ path: string | null; error: string | null }> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${supplyId}/returns/${loanId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) {
    console.error("[supply-images] return upload", error);
    return { path: null, error: error.message };
  }
  return { path, error: null };
}
