import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireRole } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Admin — SSF Gala" };

async function AdminHome() {
  const access = await requireRole("admin", "/admin");
  return (
    <>
      <p>Signed in as {access.user.email ?? "admin"}.</p>
      {access.eventId === null && <p>No active gala is set up yet.</p>}
      <nav aria-label="Admin tools">
        <ul>
          <li>
            <Link href="/admin/setup">Gala Setup</Link>
          </li>
        </ul>
      </nav>
    </>
  );
}

export default function AdminPage() {
  return (
    <main className="admin">
      <h1>Admin</h1>
      <Suspense fallback={<p>Checking access…</p>}>
        <AdminHome />
      </Suspense>
    </main>
  );
}
