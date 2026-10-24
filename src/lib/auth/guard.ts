import { forbidden, redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { decideAccess, loadAccess, type Access, type Role } from "./roles";
import { getSessionUser } from "./session";
import { safeNextPath } from "./next-path";

// The signed-in visitor's roles and active event, or null when signed out.
export async function getAccess(): Promise<Access | null> {
  const user = await getSessionUser();
  if (!user) return null;
  return loadAccess(createSupabaseAdminClient(), user);
}

// Server guard for pages, Server Actions and Route Handlers. Call it first,
// before any read or write: signed out → /signin?next=<path>, missing role
// → 403 (forbidden.tsx). Returns the caller's access (incl. eventId) for
// scoping the mutation. RLS is only the second layer.
export async function requireRole(role: Role, nextPath: string): Promise<Access> {
  const access = await getAccess();
  const decision = decideAccess(access, role);
  if (decision === "signin") {
    redirect(`/signin?next=${encodeURIComponent(safeNextPath(nextPath))}`);
  }
  if (decision === "forbidden") forbidden();
  return access as Access;
}
