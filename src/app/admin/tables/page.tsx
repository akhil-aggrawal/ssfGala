import type { Metadata } from "next";
import { AdminPlaceholder } from "@/components/admin/admin-placeholder";

export const metadata: Metadata = { title: "Tables & Seating — SSF Gala admin" };

export default function Page() {
  return <AdminPlaceholder title="Tables & Seating" path="/admin/tables" />;
}
