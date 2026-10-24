import type { Metadata } from "next";
import { AdminPlaceholder } from "@/components/admin/admin-placeholder";

export const metadata: Metadata = { title: "Gala Setup — SSF Gala admin" };

export default function Page() {
  return <AdminPlaceholder title="Gala Setup" path="/admin/setup" />;
}
