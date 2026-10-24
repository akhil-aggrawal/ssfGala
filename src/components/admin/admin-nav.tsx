"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV } from "./nav-items";

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className="admin-nav">
      <ul>
        {ADMIN_NAV.map(({ href, label }) => (
          <li key={href}>
            <Link href={href} aria-current={pathname === href ? "page" : undefined}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
