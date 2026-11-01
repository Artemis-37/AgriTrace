import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Two layouts: the repo itself (app/ beside .claude/), or app/ nested one folder deeper.
const KIT = fs.existsSync(path.join(APP_ROOT, "..", ".claude", "skills", "goat"));
export const REPO_ROOT = KIT ? path.resolve(APP_ROOT, "..") : path.resolve(APP_ROOT, "..", "..");
export const BRAINS_DIR = path.join(REPO_ROOT, ".claude", "skills", "goat", "brains");
export const AGENTS_DIR = path.join(REPO_ROOT, ".claude", "agents");
export const SESSIONS_DIR = path.join(REPO_ROOT, "sessions");

let cache = null;
export function env(key) {
  if (process.env[key]) return process.env[key];
  if (!cache) {
    cache = {};
    const p = path.join(REPO_ROOT, ".env");
    if (fs.existsSync(p)) {
      for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !(m[1] in cache)) cache[m[1]] = m[2].trim();
      }
    }
  }
  return cache[key] || "";
}
