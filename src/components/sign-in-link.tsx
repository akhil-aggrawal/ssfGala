"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// Header Sign In link that carries the current page as `next`, so the
// visitor comes back here after Google sign-in.
export function SignInLink() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const here = search ? `${pathname}?${search}` : pathname;
  const href =
    !pathname || pathname === "/" || pathname === "/signin"
      ? "/signin"
      : `/signin?next=${encodeURIComponent(here)}`;
  return <Link href={href}>Sign In</Link>;
}
