#!/usr/bin/env python3
"""super-board-restamp.py — keep migration versions ordered at merge time.

Called by super-board-merge-gate.sh inside the merge lock. A builder picks a
migration's timestamp when its branch starts; another PR can merge first with
the same version, or a later one. `supabase db reset` then fails on the
duplicate, and `supabase db push` refuses the older one. Merges are already one
at a time inside the lock, so that is where the version gets fixed.

    super-board-restamp.py restamp --repo <dir> --base <ref> --config <cfg.json>
        In <dir> (HEAD = the PR merged with <ref>), `git mv` each migration the
        PR adds, when any of them sorts at or before the newest one on <ref> in
        the same directory, to <newest>+1, +2, ... in their original order.
        Prints one `old<TAB>new` line per rename. Does not commit.

    super-board-restamp.py check --repo <dir> --base <ref> --config <cfg.json>
                                 --reviewed <sha> --head <sha>
        Exit 0 when <head> is <reviewed> plus only what the gate itself adds:
        clean merges of a commit already on <ref>, and commits that only rename
        PR migrations (100% similar, same name after the version). Exit 1 with
        the reason on stderr otherwise.

A migration is a path matching migrations.globs whose file name starts with a
14-digit version and an underscore (`20261024130000_name.sql`).
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("merge_policy", os.path.join(HERE, "super-board-merge-policy.py"))
policy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(policy)

VERSION = re.compile(r"^(\d{14})_(.+)$")


def git(repo: str, *args: str) -> str:
    return subprocess.run(["git", "-C", repo, *args], check=True, capture_output=True, text=True).stdout


def ok(repo: str, *args: str) -> bool:
    return subprocess.run(["git", "-C", repo, *args], capture_output=True).returncode == 0


def migration(path: str, globs) -> re.Match | None:
    return VERSION.match(os.path.basename(path)) if policy.matches(path, globs) else None


def restamp(repo: str, base: str, globs) -> list[tuple[str, str]]:
    added = git(repo, "diff", "--no-renames", "--name-only", "--diff-filter=A", base, "HEAD").split("\n")
    by_dir: dict[str, list[str]] = {}
    for path in added:
        if path and migration(path, globs):
            by_dir.setdefault(os.path.dirname(path), []).append(path)
    renames = []
    for directory, paths in sorted(by_dir.items()):
        on_base = git(repo, "ls-tree", "--name-only", base, directory + "/").split("\n")
        newest = max((int(m[1]) for p in on_base if p and (m := migration(p, globs))), default=None)
        paths.sort(key=lambda p: (VERSION.match(os.path.basename(p))[1], p))
        if newest is None or int(VERSION.match(os.path.basename(paths[0]))[1]) > newest:
            continue
        for i, path in enumerate(paths, start=1):
            new = os.path.join(directory, f"{newest + i:014d}_{VERSION.match(os.path.basename(path))[2]}")
            git(repo, "mv", path, new)
            renames.append((path, new))
    return renames


def check(repo: str, base: str, globs, reviewed: str, head: str, renames: dict | None = None) -> str | None:
    """None when head is reviewed + gate-shaped commits only; else the reason.

    `renames`, when given, is filled with {path at head: path at reviewed}."""
    if not ok(repo, "merge-base", "--is-ancestor", reviewed, head):
        return f"{reviewed} is not an ancestor of {head}"
    reviewed = git(repo, "rev-parse", reviewed).strip()
    base_tree = set(git(repo, "ls-tree", "-r", "--name-only", base).split("\n"))
    for line in git(repo, "rev-list", "--first-parent", "--parents", head).splitlines():
        commit, *parents = line.split()
        if commit == reviewed:
            return None
        if len(parents) == 2:
            if not ok(repo, "merge-base", "--is-ancestor", parents[1], base):
                return f"merge {commit} brings in {parents[1]}, which is not on {base}"
            merged = subprocess.run(["git", "-C", repo, "merge-tree", "--write-tree", *parents],
                                    capture_output=True, text=True)
            tree = merged.stdout.split("\n")[0]
            if merged.returncode != 0 or tree != git(repo, "rev-parse", commit + "^{tree}").strip():
                return f"merge {commit} is not a clean merge of its parents"
        elif len(parents) == 1:
            changes = git(repo, "diff-tree", "-r", "--no-commit-id", "--name-status", "-M100%",
                          parents[0], commit).splitlines()
            if not changes:
                return f"commit {commit} changes nothing"
            for change in changes:
                status, *paths = change.split("\t")
                old = migration(paths[0], globs)
                new = migration(paths[-1], globs)
                if (status != "R100" or not old or not new or paths[0] in base_tree
                        or old[2] != new[2] or os.path.dirname(paths[0]) != os.path.dirname(paths[1])):
                    return f"commit {commit} changes more than a migration's version: {change}"
                if renames is not None:
                    # Newest commit first: a path renamed again later is
                    # already a value in the map; point it further back.
                    later = next((k for k, v in renames.items() if v == paths[1]), paths[1])
                    renames[later] = paths[0]
        else:
            return f"commit {commit} has {len(parents)} parents"
    return f"{reviewed} is not on the first-parent history of {head}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=("restamp", "check"))
    ap.add_argument("--repo", required=True)
    ap.add_argument("--base", required=True)
    ap.add_argument("--config", required=True)
    ap.add_argument("--reviewed")
    ap.add_argument("--head")
    a = ap.parse_args()
    globs = (json.load(open(a.config)).get("migrations") or {}).get("globs") or policy.DEFAULT_MIGRATION_GLOBS
    if a.mode == "restamp":
        for old, new in restamp(a.repo, a.base, globs):
            print(f"{old}\t{new}")
        return 0
    why = check(a.repo, a.base, globs, a.reviewed, a.head)
    if why:
        print(why, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
