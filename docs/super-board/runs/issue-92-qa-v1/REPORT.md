# QA v1 · #92 · head 6e2812f

| AC | Result | Proof |
|---|---|---|
| 1 Two waiters racing on a dead holder's lock: one holder | ✅ | `test/super-board-local-db.test.ts:111` green 5/5 runs (`repeat-5x.txt`); red on the old `rm -rf` reap with the same pause (`race-red-on-old-reap-with-pause.txt`) |
| 2 No-pid lock past grace is reaped, waiter proceeds | ✅ | `:136` green, red on old script (`red-on-old-script.txt`); `:146` keeps a fresh no-pid lock |
| 3 Standalone super-qa e2e runs under the lock | ✅ | `:281` green; 0 unlocked `playwright test` lines in `.claude/skills/super-qa/` (`ac3-unlocked-playwright-runs.txt`) |

Full suite: `npm run verify` 394 passed, 14 skipped (`verify.txt`).

## Test gaps (not written)

- Medium: three waiters on a dead holder's lock (pauses 1, 2, 2) still give two holders at once
  (`three-waiter-race.txt`). Waiter b moves a's fresh lock away; c's `mkdir` then succeeds while a
  still holds. The moved lock `local-stack.lock.reaped.<pid>.0` is never deleted. Needs a crashed
  holder plus three callers of `lock`/`reset-main` waiting together (two lanes plus a standalone
  `/super-qa`).
- Low: inode reuse. A waiter paused across a full hold cycle could match a newer lock that reused
  the judged inode. The real judge-to-reap window is microseconds.
- Not run: stack-only scratch tests (`SB_LOCAL_DB_TESTS=1`). Scratch code is unchanged.
