import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const FORBIDDEN_EXTENSIONS = new Set([
  ".csv", ".xls", ".xlsx", ".pdf", ".txt", ".zip", ".bak",
  ".db", ".sqlite", ".sqlite3", ".log", ".pem", ".key", ".p12", ".pfx",
]);

const FORBIDDEN_BASENAME_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /^financeos-export-.*\.json$/i,
  /statement.*\.(?:csv|xlsx?|pdf)$/i,
];

const SECRET_PATTERNS = [
  { name: "private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "GitHub token", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: "GitHub token", re: /\bgh[opusr]_[A-Za-z0-9]{20,}\b/ },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Stripe secret", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  {
    name: "hard-coded wallet address",
    re: /\b(?:walletAddress|publicAddress|phantomAddress)\s*[:=]\s*["'][1-9A-HJ-NP-Za-km-z]{32,60}["']/,
  },
];

test("repository does not track obvious personal finance exports or secrets", () => {
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);

  const forbiddenFiles = tracked.filter((file) => {
    const normalized = file.replaceAll("\\", "/");
    const basename = normalized.split("/").at(-1) || normalized;
    return (
      /^(?:data|backups|exports)\//i.test(normalized) ||
      FORBIDDEN_EXTENSIONS.has(extname(basename).toLowerCase()) ||
      FORBIDDEN_BASENAME_PATTERNS.some((pattern) => pattern.test(basename))
    );
  });

  assert.deepEqual(
    forbiddenFiles,
    [],
    "Personal-data-like files must not be tracked: " + forbiddenFiles.join(", "),
  );

  const textFiles = tracked.filter((file) =>
    /\.(?:[cm]?[jt]sx?|mjs|md|css|ps1|cmd|yml|yaml|json|d\.ts)$/i.test(file),
  );

  const hits = [];
  for (const file of textFiles) {
    const source = readFileSync(file, "utf8");
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.re.test(source)) hits.push(file + ": " + pattern.name);
    }
  }

  assert.deepEqual(
    hits,
    [],
    "Potential hard-coded secrets or personal wallet identifiers found: " +
      hits.join(", "),
  );
});
