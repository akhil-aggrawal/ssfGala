import type { Metadata } from "next";
import { Suspense } from "react";
import { requireRole } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Admin — SSF Gala" };

async function AdminHome() {
  const access = await requireRole("admin", "/admin");
  return (
    <>
      <p>Signed in as {access.user.email ?? "admin"}.</p>
      {access.eventId === null && <p>No active gala is set up yet.</p>}
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
