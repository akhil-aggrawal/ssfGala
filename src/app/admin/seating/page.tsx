import { redirect } from "next/navigation";

// The ticket names /admin/seating; the sidebar's Tables & Seating page is /admin/tables.
export default function Page() {
  redirect("/admin/tables");
}
