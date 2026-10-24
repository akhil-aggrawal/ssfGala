import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const policy = fileURLToPath(
  new URL("../.claude/bin/super-board-merge-policy.py", import.meta.url),
);

type Change = { path: string; added: string[] };
type Hold = { category: string; why: string };

// Builds a unified diff that adds `added` lines to each file.
function diffOf(changes: Change[]): string {
  return changes
    .map(({ path, added }) =>
      [
        `diff --git a/${path} b/${path}`,
        "--- /dev/null",
        `+++ b/${path}`,
        `@@ -0,0 +1,${added.length} @@`,
        ...added.map((l) => `+${l}`),
      ].join("\n"),
    )
    .join("\n");
}

// Runs the policy and returns its `human` holds.
function holds(
  changes: Change[],
  { policy: mergePolicy = {}, labels = [] as string[] }: { policy?: object; labels?: string[] } = {},
): Hold[] {
  const dir = mkdtempSync(join(tmpdir(), "merge-policy-"));
  const cfg = join(dir, "cfg.json");
  const meta = join(dir, "meta.json");
  const diff = join(dir, "pr.diff");
  writeFileSync(cfg, JSON.stringify({ base_branch: "staging", merge_policy: { default: "auto", ...mergePolicy } }));
  writeFileSync(
    meta,
    JSON.stringify({
      labels: labels.map((name) => ({ name })),
      files: changes.map(({ path, added }) => ({ path, additions: added.length, deletions: 0 })),
      body: "",
    }),
  );
  writeFileSync(diff, diffOf(changes));
  const run = spawnSync("python3", [policy, "--config", cfg, "--meta", meta, "--diff", diff], {
    encoding: "utf8",
  });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout).human;
}

const serviceRole = "const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // service_role";
const dropTable = "writeFileSync(sql, 'drop table guests;');";

describe("super-board-merge-policy: keyword_exclude", () => {
  it("gives no auth hold when the only service_role line is in an e2e spec", () => {
    expect(holds([{ path: "e2e/sponsor-dashboard.spec.ts", added: [serviceRole] }])).toEqual([]);
  });

  it("gives no schema hold when the only drop table line is in a test/**/*.test.ts file", () => {
    expect(holds([{ path: "test/gate/restamp.test.ts", added: [dropTable] }])).toEqual([]);
  });

  it("still holds service_role in a migration or src file", () => {
    for (const path of ["supabase/migrations/20261024_grant.sql", "src/lib/admin.ts"]) {
      const out = holds([
        { path: "e2e/ok.spec.ts", added: ["harmless"] },
        { path, added: [serviceRole] },
      ]);
      expect(out.map((h) => h.category)).toContain("auth");
    }
  });

  it("searches every added line again when keyword_exclude is []", () => {
    const out = holds([{ path: "e2e/sponsor-dashboard.spec.ts", added: [serviceRole, dropTable] }], {
      policy: { keyword_exclude: [] },
    });
    expect(out.map((h) => h.category).sort()).toEqual(["auth", "schema"]);
  });

  it("does not let a +++ content line inside a hunk relabel a src file as a test file", () => {
    // Adding the line "++ b/e2e/x.spec.ts" to src shows up in the diff as "+++ b/e2e/x.spec.ts".
    const out = holds([{ path: "src/lib/admin.ts", added: ["++ b/e2e/x.spec.ts", serviceRole] }]);
    expect(out.map((h) => h.category)).toContain("auth");
  });

  it("checks each hunk of a multi-file diff against its own file", () => {
    const out = holds([
      { path: "src/lib/admin.ts", added: ["harmless"] },
      { path: "e2e/seed.spec.ts", added: [serviceRole] },
      { path: "scripts/reset.sql", added: [dropTable] },
    ]);
    expect(out.map((h) => h.category)).toEqual(["schema"]);
  });

  it("still holds on labels and paths when every file matches keyword_exclude", () => {
    expect(holds([{ path: "e2e/a.spec.ts", added: ["x"] }], { labels: ["auth"] })).toEqual([
      { category: "auth", why: "label auth" },
    ]);
    const out = holds([{ path: "test/payments/charge.test.ts", added: ["x"] }]);
    expect(out.map((h) => h.category)).toEqual(["money"]);
  });
});
