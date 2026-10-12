import { describe, expect, it } from "vitest";
import { decryptGoogleRefreshToken, encryptGoogleRefreshToken } from "./google-oauth.server";

describe("encrypted Google Calendar tokens", () => {
  const key = Buffer.alloc(32, 7);

  it("round trips a refresh token without storing it in plaintext", () => {
    const token = "google-refresh-token-value";
    const encrypted = encryptGoogleRefreshToken(token, key);

    expect(encrypted.ciphertext).not.toContain(token);
    expect(decryptGoogleRefreshToken(encrypted.ciphertext, encrypted.iv, key)).toBe(token);
  });

  it("rejects a token envelope that has been modified", () => {
    const encrypted = encryptGoogleRefreshToken("refresh-token", key);
    const bytes = Buffer.from(encrypted.ciphertext, "base64url");
    bytes[0] ^= 1;

    expect(() => decryptGoogleRefreshToken(bytes.toString("base64url"), encrypted.iv, key)).toThrow();
  });
});
