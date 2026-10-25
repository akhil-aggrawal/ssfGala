# QA v2 — #92 local-stack lock races (PR #98 @ 6978a22)

| AC | Result | Proof |
|---|---|---|
| AC1 one holder after a race on a dead holder's lock | ✅ | `test/super-board-local-db.test.ts` two-waiter and three-waiter tests green · both red on the old reap with a pause injected (`race-red-on-old-reap-with-pause.txt`) · three-waiter red at `a74fe04` (`red-on-old-scripts.txt`) · 5 waiters × 5 rounds, random pauses: serial, nothing left behind (`adversarial-probes.txt` P1) |
| AC2 pid-less lock past the grace is reaped | ✅ | grace tests green, red at `9056a24` · real fresh pid-less lock: waiter reaps at 11 s and runs (P4) |
| AC3 standalone super-qa e2e under the lock | ✅ | 4/4 `playwright test` lines in `.claude/skills/super-qa/` wrapped (`ac3-playwright-lines.txt`) · test green |

Other probes: waiter SIGKILLed mid-reap, next caller runs in 0 s (P2) · holder SIGKILLed, next caller reaps and runs (P3) · live holder never reaped, exit 4 (P5) · command does not inherit fd 9 (P6).

`npm run verify`: 395 passed, 14 skipped (`verify.txt`).

Test gaps (not written):
- Low: no automated test for a waiter SIGKILLed mid-reap (probe P2 covers it by hand).
- Low: a SIGKILLed holder's command keeps running after its lock is reaped (pre-existing, out of scope).

Not run: stack-only scratch tests (`SB_LOCAL_DB_TESTS=1`); scratch code unchanged.
Branch is behind `staging` by `85efbb0` (unrelated files, merges clean).
