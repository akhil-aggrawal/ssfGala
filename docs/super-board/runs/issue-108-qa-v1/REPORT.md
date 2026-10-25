# QA v1 · issue 108 · head e44f10d

- `npx vitest run test/super-board-merge-policy.test.ts`: 12 passed
- Same file with staging config (no keyword_exclude): docs/README test FAILS (1 failed, 11 passed), so the test detects the bug
- Config list = DEFAULT_KEYWORD_EXCLUDE (7 test paths) + `docs/**` + `README.md`
- `npm run verify`: 59 files passed, 468 tests passed, 20 skipped
