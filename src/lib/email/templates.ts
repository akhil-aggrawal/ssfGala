// Ticket emails in the gala poster style: black, copper, gold, serif heading.
// Confirmations show the tier only; table numbers are sent later by admins.
import { formatUsd } from "@/lib/sponsor/format";

export type GalaEvent = { name: string; dateAt: string | null; venue: string | null };

export type TicketOrder = {
  registrationId: string;
  buyerEmail: string;
  buyerName: string | null;
  amountCents: number;
  tier: string;
  attendees: { name: string; email: string }[];
  event: GalaEvent;
};

type Rendered = { subject: string; html: string; text: string };

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function formatEventDate(dateAt: string | null): string | null {
  if (!dateAt) return null;
  return new Date(dateAt).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function eventLines(event: GalaEvent): string[] {
  return [event.name, formatEventDate(event.dateAt), event.venue].filter((l): l is string => Boolean(l));
}

function layout(heading: string, rows: string[]): string {
  const body = rows.map((r) => `<p style="margin:0 0 12px;color:#f5e6c8;font-size:16px;line-height:1.5">${r}</p>`).join("");
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#000">
<div style="max-width:560px;margin:0 auto;padding:32px;background:#0b0b0b;border:1px solid #b87333">
<p style="margin:0 0 8px;color:#d4a017;font-size:12px;letter-spacing:2px;text-transform:uppercase">Small Steps Foundation</p>
<h1 style="margin:0 0 24px;color:#d4af37;font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:normal">${escapeHtml(heading)}</h1>
${body}
</div></body></html>`;
}

export function receiptEmail(order: TicketOrder): Rendered {
  const event = eventLines(order.event);
  const names = order.attendees.map((a) => a.name);
  const subject = `Your receipt for ${order.event.name}`;
  const text = [
    `Thank you${order.buyerName ? `, ${order.buyerName}` : ""}. Your payment is confirmed.`,
    `Amount paid: ${formatUsd(order.amountCents)}`,
    `Tier: ${order.tier}`,
    `Attendees: ${names.join(", ")}`,
    ...event,
  ].join("\n");
  const html = layout("Payment received", [
    `Thank you${order.buyerName ? `, ${escapeHtml(order.buyerName)}` : ""}. Your payment is confirmed.`,
    `<strong>Amount paid:</strong> ${formatUsd(order.amountCents)}`,
    `<strong>Tier:</strong> ${escapeHtml(order.tier)}`,
    `<strong>Attendees:</strong> ${names.map(escapeHtml).join(", ")}`,
    event.map(escapeHtml).join("<br>"),
  ]);
  return { subject, html, text };
}

export function attendeeConfirmationEmail(order: TicketOrder, attendee: { name: string }): Rendered {
  const event = eventLines(order.event);
  const subject = `You're confirmed for ${order.event.name}`;
  const text = [
    `Hello ${attendee.name}, your seat is confirmed.`,
    `Tier: ${order.tier}`,
    ...event,
    "Seating details will follow closer to the event.",
  ].join("\n");
  const html = layout("You're confirmed", [
    `Hello ${escapeHtml(attendee.name)}, your seat is confirmed.`,
    `<strong>Tier:</strong> ${escapeHtml(order.tier)}`,
    event.map(escapeHtml).join("<br>"),
    "Seating details will follow closer to the event.",
  ]);
  return { subject, html, text };
}

export type SponsorshipPledge = {
  sponsorshipId: string;
  sponsorEmail: string;
  sponsorName: string;
  pledgedCents: number;
  tables: { tierName: string; url: string }[];
  event: GalaEvent;
};

// One email per pledge: every table's tier and invite link, the pledged
// amount, and that payment is collected offline (no online charge in v1).
export function sponsorshipConfirmationEmail(pledge: SponsorshipPledge): Rendered {
  const event = eventLines(pledge.event);
  const subject = `Your table sponsorship for ${pledge.event.name}`;
  const amount = `Pledged amount: ${formatUsd(pledge.pledgedCents)}`;
  const offline = "No payment was taken online. Small Steps Foundation will contact you to collect your pledge offline.";
  const share = "Share each table's link with your guests so they can register.";
  const text = [
    `Thank you, ${pledge.sponsorName}. Your table sponsorship is confirmed.`,
    amount,
    offline,
    share,
    ...pledge.tables.map((t, i) => `Table ${i + 1} (${t.tierName}): ${t.url}`),
    ...event,
  ].join("\n");
  const html = layout("Thank you for sponsoring", [
    `Thank you, ${escapeHtml(pledge.sponsorName)}. Your table sponsorship is confirmed.`,
    `<strong>Pledged amount:</strong> ${formatUsd(pledge.pledgedCents)}`,
    offline,
    share,
    ...pledge.tables.map(
      (t, i) =>
        `<strong>Table ${i + 1} (${escapeHtml(t.tierName)}):</strong> <a href="${escapeHtml(t.url)}" style="color:#d4a017">${escapeHtml(t.url)}</a>`,
    ),
    event.map(escapeHtml).join("<br>"),
  ]);
  return { subject, html, text };
}
