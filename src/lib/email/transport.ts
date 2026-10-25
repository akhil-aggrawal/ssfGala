// Transactional email transport. Server only.
// EMAIL_TRANSPORT=memory keeps every message in an in-memory outbox so tests
// can assert who got which email; otherwise messages go to the Resend API.
// The sender always comes from EMAIL_FROM, never a hard-coded address.

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  // Resend drops a repeat send with the same key for 24 hours.
  idempotencyKey: string;
};

export type SentEmail = EmailMessage & { from: string };

export type EmailTransport = { send: (message: EmailMessage) => Promise<void> };

type Env = Record<string, string | undefined>;

export const outbox: SentEmail[] = [];

const RESEND_URL = "https://api.resend.com/emails";

export function createEmailTransport(env: Env = process.env, fetchImpl: typeof fetch = fetch): EmailTransport {
  return {
    async send(message) {
      const from = env.EMAIL_FROM?.trim();
      if (!from) throw new Error("EMAIL_FROM is not set");
      if (env.EMAIL_TRANSPORT === "memory") {
        outbox.push({ ...message, from });
        return;
      }
      const apiKey = env.RESEND_API_KEY?.trim();
      if (!apiKey) throw new Error("RESEND_API_KEY is not set");
      const res = await fetchImpl(RESEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": message.idempotencyKey,
        },
        body: JSON.stringify({ from, to: [message.to], subject: message.subject, html: message.html, text: message.text }),
      });
      if (!res.ok) throw new Error(`Resend send failed: ${res.status} ${await res.text().catch(() => "")}`.trim());
    },
  };
}
