// Fails the build when a server-only secret's name appears in browser code.
// Run after `next build`: scans .next/static, which is what the browser downloads.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const SERVER_ONLY_NAMES = ["SUPABASE_SERVICE_ROLE_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"];

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

export function findLeaks(dir, names = SERVER_ONLY_NAMES) {
  const leaks = [];
  for (const file of files(dir)) {
    const text = readFileSync(file, "utf8");
    for (const name of names) if (text.includes(name)) leaks.push({ file, name });
  }
  return leaks;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? ".next/static";
  const leaks = findLeaks(dir);
  for (const { file, name } of leaks) console.error(`${name} found in client bundle: ${file}`);
  if (leaks.length > 0) process.exit(1);
  console.log(`client bundle check: no server-only names in ${dir}`);
}
