import crypto from "node:crypto";
import fs from "node:fs";
import { getMasterKeyPath } from "@/lib/server/paths";

const VERSION = "v1";

function getMasterKey(): Buffer {
  const keyPath = getMasterKeyPath();

  if (fs.existsSync(keyPath)) {
    const stored = fs.readFileSync(keyPath);
    if (stored.length !== 32) {
      throw new Error("FinanceOS master key has an invalid length.");
    }
    return stored;
  }

  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}

export function encryptJson(value: unknown): string {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

export function decryptJson<T>(payload: string): T {
  const [version, iv64, tag64, encrypted64] = payload.split(":");
  if (version !== VERSION || !iv64 || !tag64 || !encrypted64) {
    throw new Error("Unsupported encrypted credential format.");
  }

  const key = getMasterKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag64, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted64, "base64")),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString("utf8")) as T;
}
