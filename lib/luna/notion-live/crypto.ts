import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, createHash } from "node:crypto";
function key() {
  const secret = process.env.LUNA_NOTION_ENCRYPTION_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!secret || secret.length < 32) throw new Error("Notion credential encryption is not configured");
  // Separate purpose-derived key; a server key rotation requires reconnection.
  return Buffer.from(hkdfSync("sha256", secret, "apollon-luna", "notion-oauth-v1", 32));
}
export function seal(value: unknown, owner: string): string {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(owner));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
export function unseal<T>(value: string, owner: string): T {
  const [version, iv, tag, data] = value.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Invalid credential envelope");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(owner)); decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8"));
}
export const randomSecret = () => randomBytes(32).toString("base64url");
export const sha256 = (value: string) => createHash("sha256").update(value).digest("base64url");
