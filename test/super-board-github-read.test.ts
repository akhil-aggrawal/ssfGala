import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const helper = fileURLToPath(
  new URL("../.claude/bin/super-board-github-read.py", import.meta.url),
);

// Runs the helper against a fake `gh` that prints `stdout` and `stderr` and exits `rc`.
function runRead(
  args: string[],
  stderr: string,
  rc: number,
  env: Record<string, string> = {},
  { kind = "json", stdout = "" }: { kind?: string; stdout?: string } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "gh-read-"));
  const calls = join(dir, "calls");
  writeFileSync(join(dir, "stderr.txt"), stderr);
  writeFileSync(join(dir, "stdout.txt"), stdout);
  writeFileSync(
    join(dir, "gh"),
    `#!/bin/sh\necho x >> "${calls}"\ncat "${join(dir, "stdout.txt")}"\ncat "${join(dir, "stderr.txt")}" >&2\nexit ${rc}\n`,
  );
  chmodSync(join(dir, "gh"), 0o755);
  const haltFile = join(dir, "github-halt.json");
  const result = spawnSync("python3", [helper, "--kind", kind, "--", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      SB_GITHUB_HALT_FILE: haltFile,
      SB_GITHUB_RETRY_DELAY: "0",
      SB_GITHUB_READ_STRICT: "",
      ...env,
    },
  });
  const attempts = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").length : 0;
  return { status: result.status, stderr: result.stderr, attempts, halted: existsSync(haltFile) };
}

const unknownField = 'Unknown JSON field: "reviewThreads"\nAvailable fields:\n  additions\n  body\n';
const slurpWithJq =
  "the `--slurp` option is not supported with `--jq` or `--template`\n\nMakes an authenticated HTTP request to the GitHub API and prints the response.\n";
const unknownFlag = "unknown flag: --bogus\n\nUsage:  gh pr view [<number> | <url> | <branch>] [flags]\n";

const prView = ["pr", "view", "58", "--json", "baseRefName,isDraft,reviewThreads"];
const slurpRead = ["api", "repos/o/r/pulls/58/comments", "--paginate", "--slurp", "--jq", "."];

describe("super-board-github-read: gh usage errors", () => {
  it("exits 64 on the first attempt for an unknown --json field, without a halt file", () => {
    const run = runRead(prView, unknownField, 1);
    expect(run).toMatchObject({ status: 64, attempts: 1, halted: false });
    expect(run.stderr).toContain("Valid form");
  });

  it("exits 64 on the first attempt for --slurp with --jq, without a halt file", () => {
    expect(runRead(slurpRead, slurpWithJq, 1)).toMatchObject({ status: 64, attempts: 1, halted: false });
  });

  it("exits 64 on the first attempt for an unknown flag, without a halt file", () => {
    expect(runRead(["pr", "view", "58", "--bogus"], unknownFlag, 1)).toMatchObject({
      status: 64,
      attempts: 1,
      halted: false,
    });
  });

  it("still halts with exit 79 under SB_GITHUB_READ_STRICT=1", () => {
    const strict = { SB_GITHUB_READ_STRICT: "1" };
    expect(runRead(prView, unknownField, 1, strict)).toMatchObject({ status: 79, halted: true });
    expect(runRead(slurpRead, slurpWithJq, 1, strict)).toMatchObject({ status: 79, halted: true });
  });
});

describe("super-board-github-read: outages still halt", () => {
  it("retries an HTTP 5xx three times, then exits 79 with a halt file", () => {
    const run = runRead(["pr", "view", "58", "--json", "body"], "HTTP 502: Bad Gateway (https://api.github.com/graphql)\n", 1);
    expect(run).toMatchObject({ status: 79, attempts: 3, halted: true });
  });

  it("retries a network timeout three times, then exits 79 with a halt file", () => {
    const run = runRead(
      ["pr", "view", "58", "--json", "body"],
      'Post "https://api.github.com/graphql": context deadline exceeded (Client.Timeout exceeded while awaiting headers)\n',
      1,
    );
    expect(run).toMatchObject({ status: 79, attempts: 3, halted: true });
  });

  it("matches usage text on the first stderr line only: an outage that quotes it later still retries and halts", () => {
    const run = runRead(
      ["pr", "view", "58", "--json", "body"],
      'HTTP 503: Service Unavailable (https://api.github.com/graphql)\nUnknown JSON field: "body"\n',
      1,
    );
    expect(run).toMatchObject({ status: 79, attempts: 3, halted: true });
  });

  it("ignores usage-like stderr when gh exits 0", () => {
    const run = runRead(["pr", "view", "58", "--json", "body"], "unknown flag: --noise\n", 0);
    // fake gh prints no stdout, so the read fails its JSON shape: retried, never treated as a usage error
    expect(run.attempts).toBe(3);
    expect(run.stderr).not.toContain("gh rejected the command");
  });
});

const quotaText = ["api", "rate_limit", "--jq", '"graphql=\\(.resources.graphql.remaining)"'];
const placeholderQuery = [
  "api",
  "graphql",
  "-f",
  'query=query{repository(owner:"{owner}",name:"{repo}"){pullRequest(number:66){title}}}',
];
const unresolved = "GraphQL: Could not resolve to a Repository with the name '{owner}/{repo}'. (repository)\n";
const quota = { kind: "quota" };

describe("super-board-github-read: malformed reads of any kind fail only that call", () => {
  it("exits 64 on the first attempt when --kind quota gets plain text from --jq, without a halt file", () => {
    const run = runRead(quotaText, "", 0, {}, { ...quota, stdout: "graphql=4000\n" });
    expect(run).toMatchObject({ status: 64, attempts: 1, halted: false });
    expect(run.stderr).toContain("--kind quota");
  });

  it("exits 64 on the first attempt for a gh usage error on a kind not in FORMS, without a halt file", () => {
    const run = runRead(["api", "rate_limit", "--bogus"], unknownFlag, 1, {}, quota);
    expect(run).toMatchObject({ status: 64, attempts: 1, halted: false });
    expect(run.stderr).toContain("--kind quota");
  });

  it("exits 64 for a graphql query with literal {owner}/{repo}, before asking GitHub, without a halt file", () => {
    const run = runRead(placeholderQuery, unresolved, 1);
    expect(run).toMatchObject({ status: 64, attempts: 0, halted: false });
    expect(run.stderr).toContain("{owner}");
  });

  it("flags {owner}/{repo} in every raw-field spelling: -f, --raw-field, --raw-field=", () => {
    const query = placeholderQuery[3];
    for (const args of [
      ["api", "graphql", "--raw-field", query],
      ["api", "graphql", `--raw-field=${query}`],
      ["api", "graphql", `-f${query}`],
    ]) {
      const run = runRead(args, unresolved, 1);
      expect(run).toMatchObject({ status: 64, attempts: 0, halted: false });
      expect(run.stderr).toContain("literal {owner}");
    }
  });

  it("lets -F/--field query=…{owner}… reach gh: gh fills placeholders in -F values", () => {
    const query = placeholderQuery[3];
    const data = { stdout: '{"data":{"repository":{"name":"ssfGala"}}}\n' };
    for (const args of [
      ["api", "graphql", "-F", query],
      ["api", "graphql", "--field", query],
      ["api", "graphql", `--field=${query}`],
    ]) {
      expect(runRead(args, "", 0, {}, data)).toMatchObject({ status: 0, attempts: 1, halted: false });
    }
  });

  it("still halts on the first attempt for real auth and permission errors", () => {
    const query = ["api", "graphql", "-f", 'query=query{repository(owner:"o",name:"r"){id}}'];
    const auth = "HTTP 401: Bad " + "credentials (https://api.github.com/graphql)\n";
    const permission = "GraphQL: Resource not accessible by integration\n";
    expect(runRead(query, auth, 1)).toMatchObject({ status: 79, attempts: 1, halted: true });
    expect(runRead(query, permission, 1)).toMatchObject({ status: 79, attempts: 1, halted: true });
  });

  it("still halts with exit 79 under SB_GITHUB_READ_STRICT=1", () => {
    const strict = { SB_GITHUB_READ_STRICT: "1" };
    const plain = { ...quota, stdout: "graphql=1\n" };
    expect(runRead(quotaText, "", 0, strict, plain)).toMatchObject({ status: 79, halted: true });
    expect(runRead(["api", "rate_limit", "--bogus"], unknownFlag, 1, strict, quota)).toMatchObject({
      status: 79,
      halted: true,
    });
    expect(runRead(placeholderQuery, unresolved, 1, strict)).toMatchObject({ status: 79, halted: true });
  });

  it("exits 64 after three attempts when a kind not in FORMS gets JSON of the wrong shape, without a halt file", () => {
    const run = runRead(["api", "rate_limit"], "", 0, {}, { ...quota, stdout: '{"resources":{}}\n' });
    expect(run).toMatchObject({ status: 64, attempts: 3, halted: false });
    expect(run.stderr).toContain("--kind quota");
  });

  it("retries an HTTP 5xx on a kind not in FORMS three times, then exits 79 with a halt file", () => {
    const run = runRead(["api", "rate_limit"], "HTTP 502: Bad Gateway (https://api.github.com/rate_limit)\n", 1, {}, quota);
    expect(run).toMatchObject({ status: 79, attempts: 3, halted: true });
  });

  it("retries a timeout on a kind not in FORMS three times, then exits 79 with a halt file", () => {
    const timeout =
      'Get "https://api.github.com/rate_limit": context deadline exceeded (Client.Timeout exceeded while awaiting headers)\n';
    expect(runRead(["api", "rate_limit"], timeout, 1, {}, quota)).toMatchObject({
      status: 79,
      attempts: 3,
      halted: true,
    });
  });
});
