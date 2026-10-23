# SSF Gala

Website and app for the **Small Steps Foundation Gala**: "An Evening That Moves You".
Saturday, January 23, 2027 · 6:30–11:00 PM · ICC, Milpitas (Founders & Friends reception at 5:30 PM).
The gala raises funds for the We Fee Inc. project in Bihar.

> **Status:** planning complete, build not started. The repo holds the build pipeline setup and agent rules; application code arrives through the cards on the [build board](https://github.com/users/akhil-aggrawal/projects/5), starting with #1 (scaffold).

## What it does

| Who | What they can do |
|---|---|
| Ticket buyer | Sign in with Google, pick a seating tier and quantity, enter each attendee's name and email, and pay with Stripe. Tickets are confirmed only after Stripe confirms the payment. |
| Table sponsor | Sign in, pledge one or more 10-seat tables by tier (paid offline, no online charge), get a unique invite link per table, copy a ready-made invitation email, and manage their guests. Paid guests can't be removed. |
| Invited guest | Open a table link, sign in, register themselves and others, and optionally contribute any amount, including nothing. |
| Organizer (admin) | Set up the gala and tiers, add complimentary or offline-paid guests, create sponsor pledges, assign tables, handle cancellations, record offline sponsor payments, and export reports. |

Seating tiers: **Silver $150 · Gold $200 · Platinum $250** per seat.

Out of scope for v1: attendee pledges, event-day QR check-in, marketing or bulk email, online sponsorship payment, card charges from the admin screens, and automatic cancellations.

## Tech stack

| Layer | Choice |
|---|---|
| App | One Next.js (App Router) TypeScript app, hosted on Railway |
| Database and sign-in | Supabase Postgres and Supabase Auth (Google only) |
| Data access | Supabase JS client with generated types (no ORM) |
| Payments | Stripe Checkout and verified webhooks |
| Email | Resend (transactional only) |

## Getting started

These commands come from the plan and will work once card #1 (scaffold) and the database cards are merged.

```bash
npm ci
cp .env.example .env.local   # then fill in the values
supabase start
supabase db reset
npm run dev
```

| Task | Command |
|---|---|
| Lint, typecheck and unit tests | `npm run verify` |
| End-to-end tests | `npx playwright test` |
| Regenerate database types | `npm run db:types` |

### Environment variables

Names only; keep values in `.env.local` and never commit them.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project (browser-safe) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase access |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe payments and webhook verification |
| `RESEND_API_KEY` | Transactional email |
| `NEXT_PUBLIC_APP_URL` | Base URL for links and redirects |

Google sign-in is configured in the Supabase dashboard (Auth → Providers → Google).

## How work gets built

The app is built card by card with [super-board](https://github.com/EricTechPro/super-board), an autonomous Build → QA → Review loop for Claude Code.

| Piece | Where |
|---|---|
| Backlog | [SsfGala build board](https://github.com/users/akhil-aggrawal/projects/5): 38 cards with acceptance criteria and dependencies |
| Branches | Work merges into `staging`; you promote `staging` to `main` |
| Merge rules | Normal changes auto-merge after review. Payment, sign-in and destructive-schema changes, and PRs over 4000 changed lines, wait for a person |
| Agent rules | [AGENTS.md](AGENTS.md) (CLAUDE.md points to it) |
| Ticket format | [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) |
| Project summary | [docs/super-board/PROJECT.md](docs/super-board/PROJECT.md) |
| Pipeline config | [.claude/super-board/configs/ssfgala.json](.claude/super-board/configs/ssfgala.json) |

Typical loop, from Claude Code in this folder:

```text
/super-board lint     # check every Ready card has testable criteria
/super-board run      # build, test, review and merge Ready cards
/super-board status   # see what's in flight
```

Direct pushes to `main` and `staging` are blocked by a guard hook; changes land through pull requests.

## Product docs

The source specs live in the [SSF Gala Product folder](https://drive.google.com/drive/folders/1LapOfhANvwsWoC7oWj73-NFLQpV-l9ml) on Google Drive:

- Product Requirements Document
- Architecture Design
- Database Schema & Technical Design
- UX Specification
- Visual Mockups (poster-inspired design: black, copper, amber and gold)
