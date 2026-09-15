export function isMissingTableError(err: unknown): boolean {
  const msg =
    err && typeof err === "object" && "message" in err
      ? String((err as { message?: unknown }).message ?? "")
      : String(err ?? "");
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code ?? "")
      : "";
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    /does not exist/i.test(msg) ||
    /Could not find the table/i.test(msg) ||
    /schema cache/i.test(msg)
  );
}
