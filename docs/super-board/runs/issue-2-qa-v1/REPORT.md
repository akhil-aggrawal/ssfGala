# QA v1 — issue #2, PR #45 @ 3f10e83

Non-visual (migration SQL); no screenshots.

| AC | Result | Proof |
|---|---|---|
| 1 `supabase db reset` clean | pass | `ac1-db-reset.log` (exit 0) |
| 2 second draft/open event fails | pass | `events_tiers_test.sql:13,22` · edges `:17,23` (draft while open, reopen closed) · `:11,33` closed/archived do not block |
| 3 negative price / bad name rejected | pass | `events_tiers_test.sql:28,35` · edges: suggested `:39`, sponsorship `:46`, inventory `:53`, update `:94`, lowercase `:67`, null `:74`, zero allowed `:60` |
| 4 types committed + verify | pass | `ac4-types-drift.log` (regen = no diff) · `ac4-verify.log` (exit 0) |

pgTAP: `pgtap-all.log` — 2 files, 26 tests, PASS.
Mutation check (`mutation-red.log`): dropping the suggested/sponsorship checks turns edge tests 5, 6, 8 red; disabling RLS lets anon read rows.

Test gaps (not written): role check `edges:102`, RLS `:110-126` added; remaining — profiles FK to auth.users (Low); user_roles duplicate (user, role) pair (Low).
