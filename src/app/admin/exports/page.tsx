import type { Metadata } from "next";
import Link from "next/link";
import { AdminPlaceholder } from "@/components/admin/admin-placeholder";

export const metadata: Metadata = { title: "Exports — SSF Gala admin" };

export default function Page() {
  return (
    <AdminPlaceholder title="Exports" path="/admin/exports">
      <p>
        <Link href="/admin/reports">View reports</Link>: tier allocations, sponsor pledges, roster, paid
        tickets, guest contributions, complimentary count, offline receipts, outstanding balances and
        overbooked tables.
      </p>
    </AdminPlaceholder>
  );
}
