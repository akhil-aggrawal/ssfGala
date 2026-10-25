import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

describe("super-board-merge-policy: keyword_exclude", { timeout: 30_000 }, () => {
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

describe("super-board-merge-policy: this repo's keyword_exclude", { timeout: 30_000 }, () => {
  const repoConfig = JSON.parse(
    readFileSync(fileURLToPath(new URL("../.claude/super-board/configs/ssfgala.json", import.meta.url)), "utf8"),
  );
  const repoPolicy = { policy: repoConfig.merge_policy };
  const stripeProse = "A refund left `open` in Stripe. needs a manual check.";

  it("passes a docs-only PR whose only keyword hit is prose in docs/** or README.md", () => {
    const out = holds(
      [
        { path: "docs/runbook.md", added: [stripeProse] },
        { path: "README.md", added: [serviceRole] },
      ],
      repoPolicy,
    );
    expect(out).toEqual([]);
  });

  it("still holds stripe. added in src/**", () => {
    const out = holds([{ path: "src/lib/pay.ts", added: ["const s = stripe.checkout;"] }], repoPolicy);
    expect(out.map((h) => h.category)).toEqual(["money"]);
  });

  it("still holds service_role added in agent files and AGENTS.md", () => {
    for (const path of [".claude/skills/super-board/SKILL.md", "AGENTS.md"]) {
      const out = holds([{ path, added: [serviceRole] }], repoPolicy);
      expect(out.map((h) => h.category)).toEqual(["auth"]);
    }
  });

  it("keeps the test-path defaults excluded", () => {
    const out = holds(
      [
        { path: "e2e/a.spec.ts", added: [serviceRole] },
        { path: "test/b.test.ts", added: [dropTable] },
        { path: "supabase/tests/c.sql", added: [serviceRole] },
        { path: "src/d.test.tsx", added: [dropTable] },
      ],
      repoPolicy,
    );
    expect(out).toEqual([]);
  });

  it("still holds on labels when every file is a docs file", () => {
    const out = holds([{ path: "docs/runbook.md", added: ["x"] }], { ...repoPolicy, labels: ["payments"] });
    expect(out.map((h) => h.category)).toEqual(["money"]);
  });
});
