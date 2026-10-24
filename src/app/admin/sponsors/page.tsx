import type { Metadata } from "next";
import { AdminPlaceholder } from "@/components/admin/admin-placeholder";

export const metadata: Metadata = { title: "Sponsors — SSF Gala admin" };

export default function Page() {
  return <AdminPlaceholder title="Sponsors" path="/admin/sponsors" />;
}
