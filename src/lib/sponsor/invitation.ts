// The invitation a sponsor copies from the dashboard and sends from their own
// email. The app never sends it. Client-safe: plain strings only.

export type InvitationInput = { eventName: string; sponsorName: string; tier: string; url: string };
export type Invitation = { subject: string; body: string };

export function invitationEmail({ eventName, sponsorName, tier, url }: InvitationInput): Invitation {
  return {
    subject: `You're invited: ${eventName}`,
    body: [
      "Hello,",
      "",
      `You're invited to join the ${tier} table sponsored by ${sponsorName} at ${eventName}.`,
      "",
      "Register your seat with this link:",
      url,
      "",
      "Sign in with Google, then add your name and email. You can register more than one guest.",
      "",
      "See you there,",
      sponsorName,
    ].join("\n"),
  };
}

// What Copy Invitation Email puts on the clipboard.
export function invitationText({ subject, body }: Invitation): string {
  return `Subject: ${subject}\n\n${body}`;
}
