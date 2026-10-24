// The public origin used to build OAuth redirect URLs. Behind Railway's
// proxy the request origin can be internal, so NEXT_PUBLIC_APP_URL wins.
export function appOrigin(requestOrigin: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  return configured ? new URL(configured).origin : requestOrigin;
}
