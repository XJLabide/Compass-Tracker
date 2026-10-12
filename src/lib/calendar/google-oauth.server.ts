import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface GoogleCalendarOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: Buffer;
}

export function getGoogleCalendarOAuthConfig(origin: string): GoogleCalendarOAuthConfig | null {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const rawKey = process.env.GOOGLE_CALENDAR_ENCRYPTION_KEY;
  if (!clientId || !clientSecret || !rawKey) return null;
  if (!/^[0-9a-f]{64}$/i.test(rawKey)) throw new Error("GOOGLE_CALENDAR_ENCRYPTION_KEY must be a 32-byte hex value.");

  return {
    clientId,
    clientSecret,
    redirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI || new URL("/api/calendar/google/callback", origin).toString(),
    encryptionKey: Buffer.from(rawKey, "hex"),
  };
}

export function encryptGoogleRefreshToken(token: string, key: Buffer): { ciphertext: string; iv: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const envelope = Buffer.concat([ciphertext, cipher.getAuthTag()]);
  return { ciphertext: envelope.toString("base64url"), iv: iv.toString("base64url") };
}

export function decryptGoogleRefreshToken(ciphertext: string, iv: string, key: Buffer): string {
  const data = Buffer.from(ciphertext, "base64url");
  if (data.length <= 16) throw new Error("Stored Google Calendar credentials are invalid.");
  const authTag = data.subarray(data.length - 16);
  const encrypted = data.subarray(0, data.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
