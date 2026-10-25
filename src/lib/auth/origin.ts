// The public origin used to build OAuth redirect URLs. Behind Railway's
// proxy the request origin can be internal, so NEXT_PUBLIC_APP_URL wins.
export function appOrigin(requestOrigin: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  return configured ? new URL(configured).origin : requestOrigin;
}

// The app origin for links built in a Server Component or Server Action.
export function requestAppOrigin(h: Headers): string {
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return appOrigin(`${h.get("x-forwarded-proto") ?? "http"}://${host}`);
}
