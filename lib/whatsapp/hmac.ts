import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyHmacSha256(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!appSecret) return false;
  if (!signatureHeader) return false;
  const expected = signatureHeader.startsWith("sha256=") ? signatureHeader.slice(7) : signatureHeader;
  const computedHex = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  try {
    const a = Buffer.from(computedHex, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function hashCode(code: string): string {
  const secret = process.env.WHATSAPP_LINK_HASH_SALT;
  if (!secret) throw new Error("WHATSAPP_LINK_HASH_SALT is required");
  return createHmac("sha256", secret).update(code.trim(), "utf8").digest("hex");
}

// simple challenge code hashing for link challenges (also uses hmac)
export function hashLinkCode(code: string): string {
  return hashCode(code);
}
