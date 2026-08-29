import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "node:crypto";
import { verifyHmacSha256, hashLinkCode } from "@/lib/whatsapp/hmac";

beforeAll(() => {
  process.env.WHATSAPP_LINK_HASH_SALT = "test-salt-for-hmac-tests";
});

describe("whatsapp hmac", () => {
  const secret = "test-secret-123";
  const body = JSON.stringify({ hello: "world" });
  const hex = createHmac("sha256", secret).update(body, "utf8").digest("hex");

  it("verifies correct signature with sha256= prefix", () => {
    expect(verifyHmacSha256(body, `sha256=${hex}`, secret)).toBe(true);
  });

  it("verifies correct signature without prefix", () => {
    expect(verifyHmacSha256(body, hex, secret)).toBe(true);
  });

  it("rejects tampered body", () => {
    expect(verifyHmacSha256(body + "x", `sha256=${hex}`, secret)).toBe(false);
  });

  it("rejects missing header when secret configured", () => {
    expect(verifyHmacSha256(body, null, secret)).toBe(false);
  });

  it("rejects missing header when secret not configured (fail closed)", () => {
    expect(verifyHmacSha256(body, null, "")).toBe(false);
  });

  it("rejects truncated signature length mismatch", () => {
    expect(verifyHmacSha256(body, hex.slice(0, 10), secret)).toBe(false);
  });

  it("hashLinkCode is deterministic and different codes differ", () => {
    const a = hashLinkCode("123456");
    const b = hashLinkCode("123456");
    const c = hashLinkCode("654321");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(64); // sha256 hex
  });
});
