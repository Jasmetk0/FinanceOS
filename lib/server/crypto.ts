import crypto from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import {
  getMasterKeyPath,
  getProtectedMasterKeyPath,
} from "@/lib/server/paths";

const VERSION = "v1";
const LOAD_WINDOWS_SECURITY = "Add-Type -AssemblyName System.Security -ErrorAction Stop;";
let cachedMasterKey: Buffer | null = null;

function validateKey(key: Buffer): Buffer {
  if (key.length !== 32) {
    throw new Error("FinanceOS master key has an invalid length.");
  }
  return key;
}

function runWindowsPowerShell(script: string): string {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encoded,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    },
  ).trim();
}

function protectWithDpapi(key: Buffer): string {
  const input = key.toString("base64");
  const script =
    LOAD_WINDOWS_SECURITY +
    "$bytes=[Convert]::FromBase64String('" +
    input +
    "');" +
    "$protected=[System.Security.Cryptography.ProtectedData]::Protect(" +
    "$bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);" +
    "[Console]::Out.Write([Convert]::ToBase64String($protected));";
  const result = runWindowsPowerShell(script);
  if (!result) throw new Error("Windows DPAPI returned an empty protected key.");
  return result;
}

function unprotectWithDpapi(payload: string): Buffer {
  const safe = payload.trim();
  const script =
    LOAD_WINDOWS_SECURITY +
    "$bytes=[Convert]::FromBase64String('" +
    safe +
    "');" +
    "$plain=[System.Security.Cryptography.ProtectedData]::Unprotect(" +
    "$bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);" +
    "[Console]::Out.Write([Convert]::ToBase64String($plain));";
  const result = runWindowsPowerShell(script);
  return validateKey(Buffer.from(result, "base64"));
}

function getWindowsMasterKey(): Buffer {
  const protectedPath = getProtectedMasterKeyPath();
  const legacyPath = getMasterKeyPath();

  if (fs.existsSync(protectedPath)) {
    return unprotectWithDpapi(fs.readFileSync(protectedPath, "utf8"));
  }

  if (fs.existsSync(legacyPath)) {
    const legacy = validateKey(fs.readFileSync(legacyPath));
    try {
      fs.writeFileSync(protectedPath, protectWithDpapi(legacy), {
        encoding: "utf8",
        mode: 0o600,
      });
      fs.unlinkSync(legacyPath);
    } catch {
      // Keep the existing raw key if DPAPI is unexpectedly unavailable so
      // existing encrypted credentials remain usable.
    }
    return legacy;
  }

  const key = crypto.randomBytes(32);
  try {
    fs.writeFileSync(protectedPath, protectWithDpapi(key), {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    fs.writeFileSync(legacyPath, key, { mode: 0o600 });
  }
  return key;
}

function getPortableMasterKey(): Buffer {
  const keyPath = getMasterKeyPath();

  if (fs.existsSync(keyPath)) {
    return validateKey(fs.readFileSync(keyPath));
  }

  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}

function getMasterKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey;

  cachedMasterKey =
    process.platform === "win32"
      ? getWindowsMasterKey()
      : getPortableMasterKey();

  return cachedMasterKey;
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
