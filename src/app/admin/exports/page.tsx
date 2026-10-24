import type { Metadata } from "next";
import { AdminPlaceholder } from "@/components/admin/admin-placeholder";

export const metadata: Metadata = { title: "Exports — SSF Gala admin" };

export default function Page() {
  return <AdminPlaceholder title="Exports" path="/admin/exports" />;
}
