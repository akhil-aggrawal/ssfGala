import type { Metadata } from "next";
import { AdminPlaceholder } from "@/components/admin/admin-placeholder";

export const metadata: Metadata = { title: "Attendees — SSF Gala admin" };

export default function Page() {
  return <AdminPlaceholder title="Attendees" path="/admin/attendees" />;
}
