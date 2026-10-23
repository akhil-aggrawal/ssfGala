# SSF Gala — project summary

Web app for the Small Steps Foundation gala ("An Evening That Moves You", Saturday January 23, 2027, ICC Milpitas). It raises funds for the We Fee Inc. project in Bihar.

Source specs: [SSF Gala Product docs](https://drive.google.com/drive/folders/1LapOfhANvwsWoC7oWj73-NFLQpV-l9ml) — PRD, Architecture Design, Database Schema & Technical Design, UX Specification, Visual Mockups.

## Users and flows

| User | Flow |
|---|---|
| Ticket buyer | Google sign-in → pick tier and quantity → name/email per attendee → pay with Stripe → confirmed by webhook |
| Table sponsor | Google sign-in → pledge 10-seat tables by tier (no online payment) → one invite link per table → dashboard, Copy Link / Copy Invitation Email, edit guests, remove unpaid guests only |
| Invited guest | Table link → Google sign-in → register one or more attendees → optional seat contribution (any amount, incl. $0) via Stripe |
| Admin | Gala setup, complimentary / offline-paid attendees, sponsor pledges, table assignment, cancellations, offline sponsor receipts, reports, CSV/Excel export |

## Stack

One Next.js TypeScript app on Railway · Supabase Postgres + Auth (Google) · Supabase JS client, no ORM · Stripe Checkout + webhooks · Resend transactional email.

## Key rules

- Tiers: Silver $150, Gold $200, Platinum $250 per seat; inventory and sponsorship amounts configurable.
- Sponsored tables accept more than 10 guests; overbooking shows only to admins.
- Confirmations show tier only; table numbers are sent later by admin.
- Sponsors cannot remove paid guests; enforced atomically in the database.
- Pledges, Stripe payments and offline receipts are tracked separately; outstanding = pledged − received.

## Out of scope (v1)

Attendee pledges · QR check-in · marketing or bulk email · online sponsorship payment · Stripe charges from admin · automatic cancellations.

## Status

Greenfield: the repo holds only a README. Backlog of 38 cards on the [SsfGala build board](https://github.com/users/akhil-aggrawal/projects/5); start with #1 (scaffold).
