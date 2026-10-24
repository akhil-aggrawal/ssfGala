import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findLeaks } from "../scripts/check-client-bundle.mjs";

function bundle(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "bundle-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

describe("client bundle check", () => {
  it("passes a clean bundle", () => {
    const dir = bundle({ "chunks/app.js": "console.log('hi')" });
    expect(findLeaks(dir)).toEqual([]);
  });

  it("flags a chunk that names the service-role key", () => {
    const dir = bundle({ "chunks/a/b.js": "process.env.SUPABASE_SERVICE_ROLE_KEY" });
    expect(findLeaks(dir)).toEqual([
      { file: join(dir, "chunks/a/b.js"), name: "SUPABASE_SERVICE_ROLE_KEY" },
    ]);
  });
});

describe("client bundle check CLI", () => {
  const script = fileURLToPath(new URL("../scripts/check-client-bundle.mjs", import.meta.url));

  it("exits 1 and names the file when the key name is in the bundle", () => {
    const dir = bundle({ "chunks/leak.js": "x=process.env.SUPABASE_SERVICE_ROLE_KEY" });
    const run = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`SUPABASE_SERVICE_ROLE_KEY found in client bundle: ${join(dir, "chunks/leak.js")}`);
  });

  it("exits 0 on a clean bundle", () => {
    const dir = bundle({ "chunks/app.js": "console.log('hi')" });
    expect(spawnSync(process.execPath, [script, dir]).status).toBe(0);
  });
});
