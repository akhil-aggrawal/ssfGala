import { Suspense, type ReactNode } from "react";
import { requireRole } from "@/lib/auth/guard";
import type { AdminHref } from "./nav-items";

async function Guarded({ path, children }: { path: AdminHref; children?: ReactNode }) {
  await requireRole("admin", path);
  return (
    <>
      {children}
      <p>This section is coming soon.</p>
    </>
  );
}

// Page for an admin section that is not built yet. It still checks the
// admin role on the server, like every admin page; children show only
// after that check passes.
export function AdminPlaceholder({
  title,
  path,
  children,
}: {
  title: string;
  path: AdminHref;
  children?: ReactNode;
}) {
  return (
    <>
      <h1>{title}</h1>
      <Suspense fallback={<p>Checking access…</p>}>
        <Guarded path={path}>{children}</Guarded>
      </Suspense>
    </>
  );
}
