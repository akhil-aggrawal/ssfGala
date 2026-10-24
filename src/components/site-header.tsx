import Link from "next/link";

const links = [
  { href: "/#about", label: "About" },
  { href: "/tickets", label: "Buy Tickets" },
  { href: "/sponsor", label: "Sponsor a Table" },
  { href: "/signin", label: "Sign In" },
];

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
        </ul>
      </nav>
    </header>
  );
}
