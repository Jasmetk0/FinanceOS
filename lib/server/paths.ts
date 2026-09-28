import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export function getFinanceOsDataDir(): string {
  const configured = process.env.FINANCEOS_DATA_DIR?.trim();
  const base =
    configured ||
    process.env.LOCALAPPDATA ||
    path.join(os.homedir(), ".financeos");

  const dir = configured ? path.resolve(configured) : path.join(base, "FinanceOS");

  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getDatabasePath(): string {
  return path.join(getFinanceOsDataDir(), "financeos.sqlite");
}

export function getMasterKeyPath(): string {
  return path.join(getFinanceOsDataDir(), "master.key");
}


export function getProtectedMasterKeyPath(): string {
  return path.join(getFinanceOsDataDir(), "master.key.dpapi");
}
