import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireRole } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Attendees — SSF Gala admin" };

async function Guarded() {
  await requireRole("admin", "/admin/attendees");
  return (
    <p>
      <Link href="/admin/attendees/new" className="gala-form__save admin-link-button">
        Add attendees
      </Link>
    </p>
  );
}

export default function AttendeesPage() {
  return (
    <>
      <h1>Attendees</h1>
      <p>Add complimentary or paid-offline guests. The attendee list is coming soon.</p>
      <Suspense fallback={<p>Checking access…</p>}>
        <Guarded />
      </Suspense>
    </>
  );
}
