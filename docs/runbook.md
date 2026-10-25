# Seasonal shutdown and next-year rollover

For organizers. Run this after the gala to close the season safely, then again before the next one.
Nothing here deletes data: payments, registrations and audit history stay in Supabase.

Allow two days. Step 3 waits for Stripe sessions to expire (24 hours).

## Before you start

| You need | Where |
|---|---|
| Admin role in the app | Sign in with Google, open `/admin` |
| Stripe Dashboard access | The live-mode account that owns `STRIPE_SECRET_KEY` |
| Supabase project access | Dashboard → SQL Editor and Database → Backups |
| Railway access | Project `ssf-gala-dev`, environment `production` |

## 1. Export the reports (gala still open)

Do this first. The admin screens only see a gala that is `draft` or `open`. Once you close it in step 2, Reports and Exports show "No active gala is set up yet."

a. Open `/admin/exports` (nav: Exports).
b. Click **Download Excel**. The one workbook holds every report, one sheet each.
c. Click **Download CSV** next to Roster, Paid tickets, Guest contributions, Offline receipts and Outstanding balances.
d. Open `/admin/reports` and check the on-screen totals match the files.
e. Save the files in the organizers' shared drive. They hold guest names and emails, so share them with organizers only.

Each download is recorded in the audit log (`/admin/audit`).

These files are a snapshot. Payments that settle in steps 3 and 4 are not in them, and the admin screens cannot export a closed gala. Step 4 has a query that lists those late payments, and the step 5 data dump holds them too.

## 2. Close registration

a. Open `/admin/setup` (nav: Gala Setup).
b. In the current gala form, set **Status** to `closed`.
c. Click save.

Closing blocks new ticket orders and new sponsored-guest registrations. Sponsor pledges can no longer be created. It cancels nothing.

Payments already in flight still settle: the Stripe webhook does not check the gala status.

## 3. Wait for Stripe sessions to settle

A buyer who started checkout before you closed can still pay until the session ends. Stripe Checkout sessions expire 24 hours after creation, and the app does not shorten that.

Wait 24 hours after step 2 before the next step.

## 4. Check every Stripe session is succeeded, failed or expired

Goal: no payment is left `pending` in the database and no session is left `open` in Stripe.

### In the database

Supabase Dashboard → SQL Editor:

```sql
select p.status, count(*)
from public.payments p
join public.events e on e.id = p.event_id
where p.provider = 'stripe' and e.status = 'closed'
group by p.status;
```

Allowed statuses: `succeeded`, `failed`, `refunded`. A `pending` row is not done.

List the pending rows:

```sql
select p.id, p.stripe_session_id, p.amount_cents, p.created_at
from public.payments p
join public.events e on e.id = p.event_id
where p.provider = 'stripe' and p.status = 'pending' and e.status = 'closed';
```

### In Stripe

a. Stripe Dashboard → Developers → Webhooks → the gala endpoint (`/api/stripe/webhook`) → Event deliveries.
b. Filter to **Failed**. Open each one and click **Resend**. A failed delivery got a 4xx or 5xx, so the app recorded nothing and the resend is processed. Resending an event the app already answered with 2xx does nothing: the app ignores any event id it has already processed.
c. Or from the Stripe CLI, list recent sessions and confirm none is `open`:

```bash
stripe checkout sessions list --limit 100
```

Each session must show `status` `complete` or `expired`. For a session still `open` after 24 hours, wait or expire it in the Dashboard.

### Fixing a pending row

For each pending row from the query above, look up its `stripe_session_id` in Stripe and find that session's webhook delivery (step 4a), then:

| Delivery result | Do this |
|---|---|
| Failed (4xx or 5xx) | Click **Resend**. The row becomes `succeeded` for a paid session or `failed` for an expired one |
| Succeeded (2xx), row still `pending` | Resending will not change it. Search the Railway deploy logs for the time of the delivery for `paid amount does not match the order` (the paid amount differed from the stored amount, so nothing was confirmed) or `no stored payment for this session`. Ask the developer before changing the row |
| No delivery at all, session `complete` or `expired` | Stripe has not sent the event. Ask the developer |

Never edit `payments` by hand and never charge a card from the admin screens.

Repeat the first query. Stop here until no `pending` row remains.

### Record late payments

Exports from step 1 miss anything that settled after them. List those payments and save the result with the exports:

```sql
select p.id, p.stripe_session_id, p.amount_cents, p.status, p.updated_at
from public.payments p
join public.events e on e.id = p.event_id
where p.provider = 'stripe' and e.status = 'closed' and p.status in ('succeeded', 'refunded')
order by p.updated_at;
```

Compare it with the Paid tickets file from step 1 and note any payment that is not in the file. In the SQL Editor, use **Export** to save the result as CSV.

## 5. Verify Supabase backups

a. Supabase Dashboard → Database → Backups.
b. Confirm a backup from after step 4 exists. Daily backups need a paid plan. If the project has none, take your own copy in the next step.
c. Take a manual copy as well, from a machine with the Supabase CLI logged in and the project linked (`supabase link --project-ref <ref>`):

```bash
supabase db dump -f gala-schema.sql
supabase db dump --data-only -f gala-data.sql
```

d. Store both files with the exports from step 1. The data file holds personal data, so keep it private.

## 6. Shut down Railway

Do this only after steps 1 to 5 are done.

a. Open Railway → project `ssf-gala-dev` → environment `production` → the app service.
b. Check `GET /api/health` on the production URL once, so you know what "up" looked like.
c. Open the service's latest deployment, open its menu and choose **Remove**. This stops the app. Variables and the service stay, so you can redeploy later.
d. Leave the `staging` environment alone unless you also want it stopped.
e. Leave Supabase running. It holds the history and costs nothing extra to keep.

To start again: Railway → the service → **Redeploy**, then check `/api/health` returns `200`.

## 7. Start next year's gala

Only one gala can be `draft` or `open` at a time. A `closed` gala does not block a new one.

a. Redeploy Railway (step 6) if it is stopped.
b. Open `/admin/setup`.
c. On the old gala, set **Status** to `archived` and save. Archived galas are read-only and stay listed under "Archived galas".
d. In the **New gala** form, enter the name, year, date and venue.
e. Review the three tiers. The form fills Silver $150, Gold $200 and Platinum $250 per seat. Set the sponsorship amount and table inventory for each.
f. Set **Status** to `draft`, then save. Switch it to `open` when ticket sales should start.

The new gala starts empty:

- No sponsors, pledges or tables are copied.
- No registrations, attendees or payments are copied.
- Last year's data stays on the archived gala and in your exports.
- Admin screens, the sponsor pages and checkout all use the new gala.

Last year's sponsors pledge again on `/sponsor` once the gala is `open`, or an organizer adds a pledge at `/admin/sponsors`.

## Checklist

- [ ] Reports exported while the gala was open
- [ ] Gala status set to `closed`
- [ ] Waited 24 hours
- [ ] No Stripe payment `pending` and no session `open`
- [ ] Backup confirmed and manual dump stored
- [ ] Railway production stopped
- [ ] Old gala `archived` and new gala created
