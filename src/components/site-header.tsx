import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/lib/auth/actions";
import { getSessionUser } from "@/lib/auth/session";
import { SignInLink } from "./sign-in-link";

const links = [
  { href: "/#about", label: "About" },
  { href: "/tickets", label: "Buy Tickets" },
  { href: "/sponsor", label: "Sponsor a Table" },
];

// Reads the session cookie, so it streams in behind a Sign In fallback.
async function AccountSlot() {
  const user = await getSessionUser();
  if (!user) return <SignInLink />;
  return (
    <details className="account-menu">
      <summary>Account</summary>
      <div className="account-menu__panel">
        {user.email && <p className="account-menu__email">{user.email}</p>}
        <form action={signOut}>
          <button type="submit">Sign out</button>
        </form>
      </div>
    </details>
  );
}

export function SiteHeader() {
  return (
    <header className="site-header">
      <nav aria-label="Main" className="site-nav">
        <Link href="/" className="site-nav__brand">
          Gala
        </Link>
        <ul className="site-nav__links">
          {links.map(({ href, label }) => (
            <li key={href}>
              <Link href={href}>{label}</Link>
            </li>
          ))}
          <li>
            <Suspense fallback={<Link href="/signin">Sign In</Link>}>
              <AccountSlot />
            </Suspense>
          </li>
        </ul>
      </nav>
    </header>
  );
}
