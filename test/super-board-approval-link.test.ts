import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const approval = fileURLToPath(new URL("../.claude/bin/super-board-approval.py", import.meta.url));
const REPO = "acme/gala";
const ISSUE = 26;
const PR = 66;
const HEAD = "a".repeat(40);

// A fake `gh` that serves one PR, the issue's comments and collaborator permissions.
const FAKE_GH = String.raw`#!/usr/bin/env python3
import json, os, sys
state = json.load(open(os.environ["FAKE_GH_STATE"]))
args = sys.argv[1:]
if args[:2] == ["api", "graphql"]:
    print(json.dumps([{"data": {"repository": state["repository"]}}]))
elif args[0] == "api" and args[-1].endswith("/permission"):
    print(json.dumps({"permission": "admin"}))
elif args[0] == "api" and "/comments" in args[-1]:
    number = args[-1].split("/issues/")[1].split("/")[0]
    print(json.dumps([state["comments"].get(number, [])]))
else:
    print("fake gh: unsupported " + " ".join(args), file=sys.stderr); sys.exit(1)
`;

function comment(id: number, body: string, at: string) {
  return { id, body, user: { login: "owner", type: "User" }, created_at: at, updated_at: at };
}

type Pr = { base: string; body: string; closing?: number[] };

function run(pr: Pr) {
  const root = mkdtempSync(join(tmpdir(), "approval-link-"));
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin", "gh"), FAKE_GH);
  chmodSync(join(root, "bin", "gh"), 0o755);
  const request = { repo: REPO, pr: PR, head: HEAD, scope: "b".repeat(64) };
  const state = {
    repository: {
      defaultBranchRef: { name: "main" },
      pullRequest: {
        headRefOid: HEAD,
        state: "OPEN",
        baseRefName: pr.base,
        body: pr.body,
        closingIssuesReferences: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: (pr.closing ?? []).map((number) => ({ number, repository: { nameWithOwner: REPO } })),
        },
      },
    },
    comments: {
      [ISSUE]: [
        comment(1, `Reason tag: 🙋 needs you\napproval-request: ${JSON.stringify(request)}`, "2026-10-24T10:00:00Z"),
        comment(2, "done", "2026-10-24T11:00:00Z"),
      ],
    },
  };
  writeFileSync(join(root, "state.json"), JSON.stringify(state));
  const result = spawnSync(
    "python3",
    [approval, "--repo", REPO, "--deps"],
    {
      input: JSON.stringify({ [ISSUE]: { number: ISSUE, needsYou: true } }),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(root, "bin")}:${process.env.PATH}`,
        FAKE_GH_STATE: join(root, "state.json"),
        SB_GITHUB_HALT_FILE: join(root, "github-halt.json"),
        SB_GITHUB_RETRY_DELAY: "0",
      },
    },
  );
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout)[ISSUE] as { needsYouDone: boolean; approvalWhy?: string };
}

describe("super-board-approval links a held PR to its issue", { timeout: 30_000 }, () => {
  it("links a PR into a non-default base through a Closes line in its body", () => {
    const verdict = run({ base: "staging", body: `Fix things.\n\nCloses #${ISSUE}` });
    expect(verdict).toMatchObject({ needsYouDone: true, approvalWhy: "trusted human confirmed the current request" });
  });

  it("accepts Fixes and a same-repository owner/repo#N reference", () => {
    expect(run({ base: "staging", body: `Fixes #${ISSUE}` }).needsYouDone).toBe(true);
    expect(run({ base: "staging", body: `resolves ACME/Gala#${ISSUE}` }).needsYouDone).toBe(true);
  });

  it("keeps a PR into a non-default base with no closing line unlinked", () => {
    const verdict = run({ base: "staging", body: `Mentions #${ISSUE} but closes nothing` });
    expect(verdict).toMatchObject({ needsYouDone: false, approvalWhy: "request issue is not linked to this PR" });
  });

  it("does not link an issue from another repository", () => {
    const verdict = run({ base: "staging", body: `Closes acme/other-repo#${ISSUE}` });
    expect(verdict).toMatchObject({ needsYouDone: false, approvalWhy: "request issue is not linked to this PR" });
  });

  it("matches full issue numbers only", () => {
    expect(run({ base: "staging", body: `Closes #${ISSUE}0` }).needsYouDone).toBe(false);
    expect(run({ base: "staging", body: `Closes #2` }).needsYouDone).toBe(false);
  });

  it("matches keywords in any case with an optional colon, but not inside another word", () => {
    expect(run({ base: "staging", body: `CLOSES: #${ISSUE}` }).needsYouDone).toBe(true);
    expect(run({ base: "staging", body: `This encloses #${ISSUE}` }).needsYouDone).toBe(false);
    expect(run({ base: "staging", body: `unfixed #${ISSUE}` }).needsYouDone).toBe(false);
  });

  it("does not link a repository whose name only starts like this one", () => {
    expect(run({ base: "staging", body: `Closes acme/gala-old#${ISSUE}` }).needsYouDone).toBe(false);
    expect(run({ base: "staging", body: `Closes xacme/gala#${ISSUE}` }).needsYouDone).toBe(false);
  });

  it("uses closingIssuesReferences only for a PR into the default branch", () => {
    expect(run({ base: "main", body: "", closing: [ISSUE] }).needsYouDone).toBe(true);
    const bodyOnly = run({ base: "main", body: `Closes #${ISSUE}` });
    expect(bodyOnly).toMatchObject({ needsYouDone: false, approvalWhy: "request issue is not linked to this PR" });
  });
});
