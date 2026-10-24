// Admin sidebar. Each href has a page under src/app/admin; unbuilt
// sections are placeholders until their tickets land.
export const ADMIN_NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/attendees", label: "Attendees" },
  { href: "/admin/sponsors", label: "Sponsors" },
  { href: "/admin/tables", label: "Tables & Seating" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/setup", label: "Gala Setup" },
  { href: "/admin/exports", label: "Exports" },
] as const;

export type AdminHref = (typeof ADMIN_NAV)[number]["href"];
