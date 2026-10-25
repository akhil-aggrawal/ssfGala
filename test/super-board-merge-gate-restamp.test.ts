import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const gate = fileURLToPath(new URL("../.claude/bin/super-board-merge-gate.sh", import.meta.url));
const MIG = "supabase/migrations";

// A fake `gh` backed by a bare `origin`: PRs are branches, `pr merge` squashes into staging.
const FAKE_GH = String.raw`#!/usr/bin/env python3
import json, os, subprocess, sys, tempfile
root = os.environ["FAKE_GH_ROOT"]
origin = os.path.join(root, "origin.git")
state_file = os.path.join(root, "prs.json")
state = json.load(open(state_file))
def git(*a, cwd=None):
    return subprocess.run(["git", *a], cwd=cwd, check=True, capture_output=True, text=True).stdout
def og(*a):
    return git("--git-dir", origin, *a)
args = sys.argv[1:]
if args[0] == "api":
    # Approval reads (super-board-approval.py): PR head, comments, permissions.
    if args[1] == "graphql":
        n = next(a.split("=", 1)[1] for a in args if a.startswith("pr="))
        print(json.dumps([{"data": {"repository": {"defaultBranchRef": {"name": "staging"}, "pullRequest": {
            "headRefOid": og("rev-parse", "refs/heads/" + state[n]["branch"]).strip(), "state": "OPEN",
            "baseRefName": "staging", "body": "",
            "closingIssuesReferences": {"pageInfo": {"hasNextPage": False, "endCursor": None}, "nodes": []}}}}}]))
    elif args[-1].endswith("/permission"):
        print(json.dumps({"permission": "admin"}))
    else:
        n = args[-1].split("/issues/")[1].split("/")[0]
        print(json.dumps([state.get("comments", {}).get(n, [])]))
    sys.exit(0)
pr = state[args[2]]
branch = pr["branch"]
if args[:2] == ["pr", "view"]:
    fields = args[args.index("--json") + 1]
    if fields == "headRefName,headRefOid":
        print(branch, og("rev-parse", "refs/heads/" + branch).strip())
    elif fields.startswith("state"):
        head = pr.get("mergedHead") or og("rev-parse", "refs/heads/" + branch).strip()
        out = {"state": pr["state"], "headRefOid": head}
        if pr["state"] == "MERGED":
            out["mergeCommit"] = {"oid": pr["mergeCommit"]}
        print(json.dumps(out))
    else:
        files = []
        for line in og("diff", "--numstat", "--no-renames", "staging..." + branch).splitlines():
            a, d, p = line.split("\t")
            files.append({"path": p, "additions": int(a), "deletions": int(d)})
        print(json.dumps({"labels": [], "files": files, "body": "", "changedFiles": len(files),
                          "additions": sum(f["additions"] for f in files),
                          "deletions": sum(f["deletions"] for f in files)}))
elif args[:2] == ["pr", "diff"]:
    sys.stdout.write(og("diff", "--no-renames", "staging..." + branch))
elif args[:2] == ["pr", "merge"]:
    want = args[args.index("--match-head-commit") + 1]
    head = og("rev-parse", "refs/heads/" + branch).strip()
    if head != want:
        print("head moved", file=sys.stderr); sys.exit(1)
    work = tempfile.mkdtemp()
    git("clone", "-q", "-b", "staging", origin, work)
    git("merge", "-q", "--squash", "origin/" + branch, cwd=work)
    git("commit", "-q", "-m", "squash " + branch, cwd=work)
    git("push", "-q", "origin", "staging", cwd=work)
    og("branch", "-D", branch)
    pr.update(state="MERGED", mergedHead=head, mergeCommit=git("rev-parse", "HEAD", cwd=work).strip())
    json.dump(state, open(state_file, "w"))
else:
    print("fake gh: unsupported " + " ".join(args), file=sys.stderr); sys.exit(1)
`;

type Board = ReturnType<typeof makeBoard>;

function makeBoard() {
  const root = mkdtempSync(join(tmpdir(), "merge-gate-"));
  const gitconfig = join(root, "gitconfig");
  writeFileSync(gitconfig, "");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(root, "bin")}:${process.env.PATH}`,
    FAKE_GH_ROOT: root,
    SB_GITHUB_HALT_FILE: join(root, "github-halt.json"),
    SB_GITHUB_RETRY_DELAY: "0",
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
  };
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin", "gh"), FAKE_GH);
  chmodSync(join(root, "bin", "gh"), 0o755);
  writeFileSync(join(root, "prs.json"), "{}");

  const work = join(root, "work");
  const repo = join(root, "repo");
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync("git", args, { cwd, env, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const add = (files: Record<string, string>, msg: string) => {
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(work, path, ".."), { recursive: true });
      writeFileSync(join(work, path), body);
    }
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", msg);
    return git(work, "rev-parse", "HEAD");
  };
  git(root, "init", "-q", "--bare", "-b", "staging", "origin.git");
  git(root, "clone", "-q", join(root, "origin.git"), "work");
  git(work, "checkout", "-q", "-b", "staging");
  add({ [`${MIG}/20261024100000_a.sql`]: "select 1;\n" }, "init");
  git(work, "push", "-q", "origin", "staging");
  git(root, "clone", "-q", join(root, "origin.git"), "repo");

  const writeConfig = (verify: string[], extra: Record<string, unknown> = {}) => {
    const path = join(root, `config-${verify.length}-${Math.random()}.json`);
    writeFileSync(
      path,
      JSON.stringify({
        base_branch: "staging",
        repo: { remote: "https://github.com/o/r", path: repo },
        verify_commands: verify,
        merge_policy: { default: "auto", auto_max_lines: 0, always_human: {} },
        migrations: { allowed_envs: ["test"], target_env: "test", commands: { test: "-" } },
        ...extra,
      }),
    );
    return path;
  };
  // Fails when two migrations share a version, like `supabase db reset` would.
  const uniqueVersions = `test -z "$(ls ${MIG} | cut -c1-14 | sort | uniq -d)"`;
  const config = writeConfig([uniqueVersions]);

  return {
    root,
    env,
    config,
    writeConfig,
    git: (...args: string[]) => git(work, ...args),
    origin: (...args: string[]) => git(join(root, "origin.git"), ...args),
    /** Commit files onto staging in origin, as if another PR merged. */
    landOnBase(files: Record<string, string>) {
      git(work, "checkout", "-q", "staging");
      git(work, "pull", "-q", "origin", "staging");
      add(files, "base moves");
      git(work, "push", "-q", "origin", "staging");
    },
    /** Open a PR branch off `from` (default: the first staging commit). Returns its head. */
    openPr(n: number, files: Record<string, string>, from = "staging") {
      git(work, "fetch", "-q", "origin");
      git(work, "checkout", "-q", "-B", `pr-${n}`, from === "staging" ? "origin/staging" : from);
      const head = add(files, `pr ${n}`);
      git(work, "push", "-q", "origin", `pr-${n}`);
      const prs = JSON.parse(readFileSync(join(root, "prs.json"), "utf8"));
      prs[n] = { branch: `pr-${n}`, state: "OPEN" };
      writeFileSync(join(root, "prs.json"), JSON.stringify(prs));
      return head;
    },
    pushToPr(n: number, files: Record<string, string>) {
      git(work, "checkout", "-q", `pr-${n}`);
      git(work, "pull", "-q", "origin", `pr-${n}`);
      add(files, `more on pr ${n}`);
      git(work, "push", "-q", "origin", `pr-${n}`);
    },
    pr(n: number) {
      return JSON.parse(readFileSync(join(root, "prs.json"), "utf8"))[n];
    },
    /** The owner posts the gate's pinned 🙋 request on PR n, then replies `done`. */
    approve(n: number, gateOutput: string) {
      const line = gateOutput.split("\n").find((l) => l.startsWith("approval-request: "));
      if (!line) throw new Error(`no approval request in gate output:\n${gateOutput}`);
      const user = { login: "owner", type: "User" };
      const at = (t: string) => ({ created_at: t, updated_at: t });
      const prs = JSON.parse(readFileSync(join(root, "prs.json"), "utf8"));
      prs.comments = {
        [n]: [
          { id: 1, user, body: `Reason tag: 🙋 needs you\n${line}`, ...at("2026-10-24T10:00:00Z") },
          { id: 2, user, body: "done", ...at("2026-10-24T11:00:00Z") },
        ],
      };
      writeFileSync(join(root, "prs.json"), JSON.stringify(prs));
    },
    migrated() {
      const log = join(root, "migrated.log");
      return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
    },
    migrationsOnBase() {
      return git(join(root, "origin.git"), "ls-tree", "--name-only", "staging", `${MIG}/`)
        .split("\n")
        .map((p) => p.slice(MIG.length + 1));
    },
  };
}

function args(board: Board, pr: number, head: string, config = board.config) {
  return ["--config", config, "--pr", String(pr), "--expect-head", head, "--lock-timeout", "60"];
}

function runGate(board: Board, pr: number, head: string, config?: string) {
  const r = spawnSync("bash", [gate, ...args(board, pr, head, config)], { env: board.env, encoding: "utf8" });
  return { status: r.status, out: r.stdout + r.stderr };
}

function runGateAsync(board: Board, pr: number, head: string) {
  return new Promise<{ status: number | null; out: string }>((resolve) => {
    const child = spawn("bash", [gate, ...args(board, pr, head)], { env: board.env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (status) => resolve({ status, out }));
  });
}

const versions = (names: string[]) => names.map((n) => n.slice(0, 14));

// Each case builds real git repos and runs the gate end to end.
describe("merge gate: re-stamps migrations inside the lock", { timeout: 60_000 }, () => {
  it("renames a migration that reuses a merged version so it sorts after every base migration", () => {
    const b = makeBoard();
    const head = b.openPr(1, { [`${MIG}/20261024130000_x.sql`]: "select 2;\n" });
    b.landOnBase({ [`${MIG}/20261024130000_y.sql`]: "select 3;\n" });

    const run = runGate(b, 1, head);

    expect(run.status, run.out).toBe(0);
    expect(b.migrationsOnBase()).toEqual([
      "20261024100000_a.sql",
      "20261024130000_y.sql",
      "20261024130001_x.sql",
    ]);
  });

  it("renames a migration that sorts before the newest merged one", () => {
    const b = makeBoard();
    const head = b.openPr(2, { [`${MIG}/20261024126000_x.sql`]: "select 2;\n" });
    b.landOnBase({ [`${MIG}/20261024160000_b.sql`]: "select 3;\n" });

    const run = runGate(b, 2, head);

    expect(run.status, run.out).toBe(0);
    expect(b.migrationsOnBase()).toEqual([
      "20261024100000_a.sql",
      "20261024160000_b.sql",
      "20261024160001_x.sql",
    ]);
  });

  it("keeps the PR's own migrations in order when it re-stamps several", () => {
    const b = makeBoard();
    const head = b.openPr(3, {
      [`${MIG}/20261024110000_first.sql`]: "select 2;\n",
      [`${MIG}/20261024170000_second.sql`]: "select 3;\n",
    });
    b.landOnBase({ [`${MIG}/20261024160000_b.sql`]: "select 4;\n" });

    expect(runGate(b, 3, head).status).toBe(0);
    expect(b.migrationsOnBase().slice(-2)).toEqual(["20261024160001_first.sql", "20261024160002_second.sql"]);
  });

  it("merges two migration PRs gated together with strictly increasing, unique versions", async () => {
    const b = makeBoard();
    const h1 = b.openPr(4, { [`${MIG}/20261024110000_p.sql`]: "select 2;\n" });
    const h2 = b.openPr(5, { [`${MIG}/20261024110000_q.sql`]: "select 3;\n" });
    b.landOnBase({ [`${MIG}/20261024120000_c.sql`]: "select 4;\n" });

    const [r1, r2] = await Promise.all([runGateAsync(b, 4, h1), runGateAsync(b, 5, h2)]);

    expect(r1.status, r1.out).toBe(0);
    expect(r2.status, r2.out).toBe(0);
    const v = versions(b.migrationsOnBase());
    expect(new Set(v).size).toBe(v.length);
    expect(v).toEqual([...v].sort());
    expect(v.slice(-2)).toEqual(["20261024120001", "20261024120002"]);
  });

  it("still exits 6 when the head moved by anything other than base merges and re-stamps", () => {
    const b = makeBoard();
    const head = b.openPr(6, { [`${MIG}/20261024130000_x.sql`]: "select 2;\n" });
    b.pushToPr(6, { "src/app.ts": "export const x = 1;\n" });

    const run = runGate(b, 6, head);

    expect(run.status, run.out).toBe(6);
    expect(b.pr(6).state).toBe("OPEN");
  });

  it("exits 6 when a rename after review also changes the migration's SQL", () => {
    const b = makeBoard();
    const head = b.openPr(7, { [`${MIG}/20261024130000_x.sql`]: "select 2;\n" });
    b.git("checkout", "-q", "pr-7");
    b.git("mv", `${MIG}/20261024130000_x.sql`, `${MIG}/20261024130001_x.sql`);
    writeFileSync(join(b.root, "work", MIG, "20261024130001_x.sql"), "drop table guests;\n");
    b.git("commit", "-q", "-am", "rename and edit");
    b.git("push", "-q", "origin", "pr-7");

    expect(runGate(b, 7, head).status).toBe(6);
  });

  // QA (#76 AC4): every other shape a moved head can take must still void the review.
  describe("head guard rejects anything that is not a clean base merge or a pure re-stamp", () => {
    const pushPr = (b: Board, n: number) => b.git("push", "-q", "origin", `pr-${n}`);

    it("exits 6 on a base merge that sneaks in an extra change (evil merge)", () => {
      const b = makeBoard();
      const head = b.openPr(11, { [`${MIG}/20261024130000_x.sql`]: "select 2;\n" });
      b.landOnBase({ [`${MIG}/20261024140000_y.sql`]: "select 3;\n" });
      b.git("checkout", "-q", "pr-11");
      b.git("merge", "-q", "--no-commit", "origin/staging");
      writeFileSync(join(b.root, "work", "evil.ts"), "export const evil = 1;\n");
      b.git("add", "evil.ts");
      b.git("commit", "-q", "--no-edit");
      pushPr(b, 11);

      const run = runGate(b, 11, head);
      expect(run.status, run.out).toBe(6);
      expect(run.out).toContain("not a clean merge");
      expect(b.pr(11).state).toBe("OPEN");
    });

    it("exits 6 on a merge that brings in a commit not on the base", () => {
      const b = makeBoard();
      const head = b.openPr(12, { [`${MIG}/20261024130000_x.sql`]: "select 2;\n" });
      b.openPr(13, { "src/other.ts": "export const o = 1;\n" });
      b.git("checkout", "-q", "pr-12");
      b.git("merge", "-q", "--no-edit", "pr-13");
      pushPr(b, 12);

      const run = runGate(b, 12, head);
      expect(run.status, run.out).toBe(6);
      expect(run.out).toContain("which is not on origin/staging");
    });

    it("exits 6 on a 100% rename of a file that is not a migration", () => {
      const b = makeBoard();
      const head = b.openPr(14, {
        [`${MIG}/20261024130000_x.sql`]: "select 2;\n",
        "src/app.ts": "export const x = 1;\n",
      });
      b.git("checkout", "-q", "pr-14");
      b.git("mv", "src/app.ts", "src/renamed.ts");
      b.git("commit", "-q", "-m", "rename app");
      pushPr(b, 14);

      expect(runGate(b, 14, head).status).toBe(6);
    });

    it("exits 6 on a re-stamp that also changes the migration's name", () => {
      const b = makeBoard();
      const head = b.openPr(15, { [`${MIG}/20261024130000_x.sql`]: "select 2;\n" });
      b.git("checkout", "-q", "pr-15");
      b.git("mv", `${MIG}/20261024130000_x.sql`, `${MIG}/20261024130001_other.sql`);
      b.git("commit", "-q", "-m", "rename and retitle");
      pushPr(b, 15);

      expect(runGate(b, 15, head).status).toBe(6);
    });

    it("exits 6 on a rename of a migration that is already on the base", () => {
      const b = makeBoard();
      const head = b.openPr(16, { [`${MIG}/20261024130000_x.sql`]: "select 2;\n" });
      b.git("checkout", "-q", "pr-16");
      b.git("mv", `${MIG}/20261024100000_a.sql`, `${MIG}/20261024190000_a.sql`);
      b.git("commit", "-q", "-m", "move a merged migration");
      pushPr(b, 16);

      expect(runGate(b, 16, head).status).toBe(6);
    });

    it("exits 6 when the reviewed head is not in the PR's history (force-push)", () => {
      const b = makeBoard();
      const head = b.openPr(17, { [`${MIG}/20261024130000_x.sql`]: "select 2;\n" });
      b.git("checkout", "-q", "-B", "pr-17", "origin/staging");
      writeFileSync(join(b.root, "work", "rewrite.ts"), "export const r = 1;\n");
      b.git("add", "rewrite.ts");
      b.git("commit", "-q", "-m", "rewritten");
      b.git("push", "-q", "--force", "origin", "pr-17");

      const run = runGate(b, 17, head);
      expect(run.status, run.out).toBe(6);
      expect(run.out).toContain("is not an ancestor");
    });
  });

  it("accepts its own pushed re-stamp on a re-run after verification failed", () => {
    const b = makeBoard();
    const head = b.openPr(8, { [`${MIG}/20261024130000_x.sql`]: "select 2;\n" });
    b.landOnBase({ [`${MIG}/20261024130000_y.sql`]: "select 3;\n" });

    const red = runGate(b, 8, head, b.writeConfig(["false"]));
    expect(red.status, red.out).toBe(2);
    expect(b.origin("rev-parse", "refs/heads/pr-8")).not.toBe(head);

    const green = runGate(b, 8, head);
    expect(green.status, green.out).toBe(0);
    expect(b.migrationsOnBase()).toContain("20261024130001_x.sql");
  });

  it("merges a PR that adds no migration with no extra commit", () => {
    const b = makeBoard();
    const head = b.openPr(9, { "src/app.ts": "export const x = 1;\n" });
    b.landOnBase({ [`${MIG}/20261024160000_b.sql`]: "select 3;\n" });

    expect(runGate(b, 9, head).status).toBe(0);
    expect(b.pr(9).mergedHead).toBe(head);
  });

  it("merges a migration that already sorts after the base with no extra commit", () => {
    const b = makeBoard();
    const head = b.openPr(10, { [`${MIG}/20261024170000_x.sql`]: "select 2;\n" });
    b.landOnBase({ [`${MIG}/20261024160000_b.sql`]: "select 3;\n" });

    expect(runGate(b, 10, head).status).toBe(0);
    expect(b.pr(10).mergedHead).toBe(head);
    expect(existsSync(join(b.root, "github-halt.json"))).toBe(false);
  });
});

// #88: a re-stamp must not void an owner's approval, and no env is migrated
// unless the head being merged is approved or needs no approval.
describe("merge gate: approval survives its own re-stamp and gates migrations", { timeout: 60_000 }, () => {
  const migrate = { test: 'echo "$(git rev-parse HEAD)" >> "$FAKE_GH_ROOT/migrated.log"' };
  const humanConfig = (b: Board, verify: string[] = []) =>
    b.writeConfig(verify, {
      merge_policy: { default: "human", auto_max_lines: 0, always_human: {} },
      migrations: { allowed_envs: ["test"], target_env: "test", commands: migrate },
    });

  it("merges a PR approved at H whose only gate changes are a base merge and a rename, with no second done", () => {
    const b = makeBoard();
    const config = humanConfig(b);
    const head = b.openPr(20, { [`${MIG}/20261024128000_x.sql`]: "select 2;\n" });
    b.landOnBase({ [`${MIG}/20261024160000_y.sql`]: "select 3;\n" });

    const ask = runGate(b, 20, head, config);
    expect(ask.status, ask.out).toBe(7);
    b.approve(20, ask.out);

    const run = runGate(b, 20, head, config);

    expect(run.status, run.out).toBe(0);
    expect(run.out).not.toContain("approval-request:");
    expect(b.migrationsOnBase()).toContain("20261024160001_x.sql");
    // AC4: the approved migration PR still migrates, and it migrates the merged head.
    expect(b.migrated()).toEqual([b.pr(20).mergedHead]);
  });

  it("still honours the approval for H on a re-run after its pushed re-stamp failed verification", () => {
    const b = makeBoard();
    const config = humanConfig(b);
    const head = b.openPr(24, { [`${MIG}/20261024128000_x.sql`]: "select 2;\n" });
    b.landOnBase({ [`${MIG}/20261024160000_y.sql`]: "select 3;\n" });
    b.approve(24, runGate(b, 24, head, config).out);

    const red = runGate(b, 24, head, humanConfig(b, ["false"]));
    expect(red.status, red.out).toBe(2);
    expect(b.origin("rev-parse", "refs/heads/pr-24")).not.toBe(head);
    expect(b.migrated()).toEqual([]);

    const run = runGate(b, 24, head, config);
    expect(run.status, run.out).toBe(0);
    expect(b.migrated()).toEqual([b.pr(24).mergedHead]);
  });

  it("asks again (exit 7) and migrates nothing when the PR gained any other change after H", () => {
    const b = makeBoard();
    const config = humanConfig(b);
    const head = b.openPr(21, { [`${MIG}/20261024128000_x.sql`]: "select 2;\n" });
    b.landOnBase({ [`${MIG}/20261024160000_y.sql`]: "select 3;\n" });
    b.approve(21, runGate(b, 21, head, config).out);
    b.pushToPr(21, { "src/app.ts": "export const x = 1;\n" });
    const newHead = b.origin("rev-parse", "refs/heads/pr-21");

    const run = runGate(b, 21, newHead, config);

    expect(run.status, run.out).toBe(7);
    expect(run.out).toContain("approval-request:");
    expect(b.migrated()).toEqual([]);
    expect(b.pr(21).state).toBe("OPEN");
  });

  it("does not carry an approval across a rename that also edits the migration's SQL", () => {
    const b = makeBoard();
    const config = humanConfig(b);
    const head = b.openPr(26, { [`${MIG}/20261024128000_x.sql`]: "select 2;\n" });
    b.approve(26, runGate(b, 26, head, config).out);
    // Looks like the gate's re-stamp, but the SQL the owner approved is gone.
    b.git("checkout", "-q", "pr-26");
    b.git("mv", `${MIG}/20261024128000_x.sql`, `${MIG}/20261024128001_x.sql`);
    writeFileSync(join(b.root, "work", MIG, "20261024128001_x.sql"), "drop table guests;\n");
    b.git("commit", "-q", "-am", "rename and edit");
    b.git("push", "-q", "origin", "pr-26");
    const newHead = b.origin("rev-parse", "refs/heads/pr-26");

    const run = runGate(b, 26, newHead, config);

    expect(run.status, run.out).toBe(7);
    expect(run.out).toContain("approval-request:");
    expect(b.migrated()).toEqual([]);
    expect(b.pr(26).state).toBe("OPEN");
  });

  it("exits 7 and migrates nothing when the approval is withdrawn while verification runs", () => {
    const b = makeBoard();
    const head = b.openPr(25, { [`${MIG}/20261024128000_x.sql`]: "select 2;\n" });
    b.landOnBase({ [`${MIG}/20261024160000_y.sql`]: "select 3;\n" });
    b.approve(25, runGate(b, 25, head, humanConfig(b)).out);
    // The owner's `done` disappears mid-verify, after the first approval check passed.
    const withdraw = `python3 -c 'import json,os; p=os.path.join(os.environ["FAKE_GH_ROOT"],"prs.json"); s=json.load(open(p)); s["comments"]["25"]=[c for c in s["comments"]["25"] if c["body"]!="done"]; json.dump(s,open(p,"w"))'`;

    const run = runGate(b, 25, head, humanConfig(b, [withdraw]));

    expect(b.migrated()).toEqual([]);
    expect(run.status, run.out).toBe(7);
    expect(run.out).toContain("nothing was migrated");
    expect(run.out).toContain("approval-request:");
    expect(b.pr(25).state).toBe("OPEN");
  });

  it("exits 8 for a human step before any allowed env is migrated", () => {
    const b = makeBoard();
    const config = b.writeConfig([], {
      migrations: { allowed_envs: ["test"], target_env: "live", commands: { ...migrate, live: "push-live" } },
    });
    const head = b.openPr(22, { [`${MIG}/20261024170000_x.sql`]: "select 2;\n" });

    const run = runGate(b, 22, head, config);

    expect(run.status, run.out).toBe(8);
    expect(run.out).toContain("needs-you: push-live");
    expect(b.migrated()).toEqual([]);
  });

  it("migrates and merges once a human approved the human step", () => {
    const b = makeBoard();
    const config = b.writeConfig([], {
      migrations: { allowed_envs: ["test"], target_env: "live", commands: { ...migrate, live: "push-live" } },
    });
    const head = b.openPr(23, { [`${MIG}/20261024170000_x.sql`]: "select 2;\n" });
    b.approve(23, runGate(b, 23, head, config).out);

    const run = runGate(b, 23, head, config);

    expect(run.status, run.out).toBe(0);
    expect(b.migrated()).toEqual([head]);
  });
});
