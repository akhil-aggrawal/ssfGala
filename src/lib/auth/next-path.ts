// Where to send the user after sign-in. Only same-origin paths are kept;
// anything else (another origin, protocol-relative `//host`, `/\host`,
// a bare scheme) falls back to `/` so the OAuth round trip cannot be
// turned into an open redirect.
const BASE = "http://next-path.invalid";

export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  if (next.includes("\\")) return "/";
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return "/";
  }
  if (url.origin !== BASE) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}
