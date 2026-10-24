import { Suspense } from "react";
import { requireRole } from "@/lib/auth/guard";
import type { AdminHref } from "./nav-items";

async function Guarded({ path }: { path: AdminHref }) {
  await requireRole("admin", path);
  return <p>This section is coming soon.</p>;
}

// Page for an admin section that is not built yet. It still checks the
// admin role on the server, like every admin page.
export function AdminPlaceholder({ title, path }: { title: string; path: AdminHref }) {
  return (
    <>
      <h1>{title}</h1>
      <Suspense fallback={<p>Checking access…</p>}>
        <Guarded path={path} />
      </Suspense>
    </>
  );
}
