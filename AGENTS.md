# SSF Gala

Gala website and app for Small Steps Foundation: ticket sales, table sponsorships, invited-guest registration, admin tools. Specs: [SSF Gala Product docs](https://drive.google.com/drive/folders/1LapOfhANvwsWoC7oWj73-NFLQpV-l9ml) (PRD, Architecture, Database Schema, UX, Visual Mockups).

## Commands

| Task | Command |
|---|---|
| Install | `npm ci` |
| Dev server | `npm run dev` |
| Lint + typecheck + unit tests | `npm run verify` |
| E2E tests | `npx playwright test` |
| Local database | `supabase start` · `supabase db reset` |
| DB types | `npm run db:types` |

## Stack

| Layer | Choice |
|---|---|
| App | One Next.js (App Router) TypeScript app; deploy on Railway |
| Data + auth | Supabase Postgres, Supabase Auth (Google provider only) |
| DB access | Supabase JS client + generated types. NO ORM |
| Payments | Stripe Checkout + verified webhooks |
| Email | Resend, transactional only |

NEVER add a separate API server, Python runtime, Redis, queue or microservice.

## Where things live

| What | Where |
|---|---|
| SQL migrations | `supabase/migrations/` |
| Generated DB types | committed in repo; regenerate after every migration |
| Agent docs | `docs/agents/`, `docs/super-board/` |

## Conventions

| Rule | Detail |
|---|---|
| Money | integer USD cents (`*_cents`), never floats |
| Keys | UUID primary keys, `timestamptz` timestamps, indexed `event_id` |
| Events | one active gala at a time; archived events read-only |
| Tiers | Silver $150, Gold $200, Platinum $250 per seat; prices read from DB |
| Attendees | every attendee has name + email; signed-in user may register many |
| Deletes | soft-cancel (`cancelled_at` / status); NEVER delete financial history |
| Audit | admin and sponsor edits write `audit_logs` in the same transaction |
| UI | public site: poster style (black, copper, amber, gold, serif headings); forms and admin stay high-contrast; mobile-first, WCAG AA |

## Boundaries

**Always**
- Check role and event scope on the server for EVERY mutation; RLS is defense in depth.
- Treat the Stripe webhook as the only source of payment truth; verify signature; dedupe by event ID.
- Compute prices and amounts on the server.
- Accept sponsored-table registrations past capacity (10); flag overbooking for admins only.

**Ask first**
- Any change to RLS policies or SECURITY DEFINER functions.
- Destructive migrations (DROP / TRUNCATE / RENAME).

**Never**
- NEVER expose the Supabase service-role key or Stripe secret to the browser.
- NEVER store card data; store Stripe IDs only.
- NEVER charge cards from the admin interface.
- NEVER let sponsors remove a guest who has paid.
- NEVER tell guests a table is overbooked; NEVER auto-cancel registrations.
- NEVER add attendee pledges, bulk/marketing email, QR check-in, or online sponsorship payment (v1 out of scope).
- NEVER read or print `.env` files.

<!-- super-board:begin v3.1.2 (managed; edits inside are overwritten on upgrade) -->
## Super Board

Board: Backlog · Ready · Building · QA · Review · Blocked · Done. Labels route: `qa` skips Building · `bug`, `feature`, none → built first.

| When | Use | NEVER |
|---|---|---|
| Set up / repair the board | `/super-board onboard` | DON'T hand-edit config mid-run |
| Check tickets before a run | `/super-board lint` | NEVER run with AC-less tickets |
| Drain the board | `/super-board run` | NEVER build, test or merge from the orchestrator |
| Board state / halt | `/super-board status` · `/super-board stop` | |
| Build one ticket | `/super-build` | NEVER build outside the card's worktree |
| QA a branch, or a live URL alone | `/super-qa` · `/super-qa <url>` | NEVER mark QA pass without evidence |
| Review a PR, merge | `/super-review` | NEVER `gh pr merge` direct — merge gate only |
| File bugs from Sentry, PostHog, PRs | `/super-collect` | DON'T file without a verifier pass |
| UI polish | `/ui-refine-loop` (human runs it) | board NEVER runs it |
| Diagram / explainer page | `/visual` | |
| Commit, pull, push this branch | `/git-sync` | NEVER force push or rebase shared history |

| Rule | Value |
|---|---|
| Config | `.claude/super-board/configs/<slug>.json` |
| Isolation | 1 card · 1 worktree · 1 branch |
| Merge | auto for normal changes · money, auth, destructive schema (DROP/TRUNCATE/RENAME) → human · PR > 4000 changed lines → human |
| Migrations | additive → robot migrates allowed DBs only · live DB ALWAYS → 🙋 needs you |
| Blocked card | block-template comment · last line `blocked-by:` · 🙋 = needs you |
| Secrets | NEVER read `.env`; key names via `.claude/bin/super-board-env-check.sh` |

## Writing (super-board)

| Thing | Format → `.claude/skills/super-board/references/writing-standard.md` |
|---|---|
| Commit, PR title | `<emoji> [type] scope: subject` + short bullets · ✨ feat 🐛 fix 🔧 chore ♻️ refactor 🧪 test 📝 docs |
| PR body | blocks: status · Problem · Solution · AC + proof · history · Before\|After · Risk — `super-board-pr-body.sh` |
| Ticket | Problem · Context · Fix · AC · Risk · Blocked by → `docs/agents/issue-tracker.md` |
| Comment | `[role] [label] status` · Did · ✅ Done · ❌ Not done · Next · ≤ 8 lines |
| PR author notes | file + critical inline review comments: Purpose · What changed · Why it matters → `pr-author-notes.md` |

- NEVER chain steps with arrows. One step per line, lettered under Where.
- NEVER link screenshots. Embed a raw URL pinned to a sha.
- DON'T repeat file lists in status comments. DON'T write "Not verified" or "Next" in a PR body.
<!-- super-board:end -->

## Commits and PRs

One logical change per commit. Each PR closes one board card and stays under 4000 changed lines (`merge_policy.auto_max_lines`). Ticket and PR writing follow `docs/agents/issue-tracker.md`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
