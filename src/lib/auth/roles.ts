import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { SessionUser } from "./session";

export const ROLES = ["admin", "sponsor", "attendee"] as const;
export type Role = (typeof ROLES)[number];

// Who the visitor is, every role they hold (one identity may hold several),
// and the active gala their actions are scoped to (null when none is set up).
export type Access = { user: SessionUser; roles: Role[]; eventId: string | null };

export type AccessDecision = "signin" | "forbidden" | "allow";

const isRole = (value: string): value is Role => (ROLES as readonly string[]).includes(value);

// Load the user's roles and the active event with the service-role client:
// RLS has no policies yet, so the user's own client would see no rows.
// A failed query throws, so a DB error never reads as "no role".
export async function loadAccess(
  admin: SupabaseClient<Database>,
  user: SessionUser,
): Promise<Access> {
  const [roles, event] = await Promise.all([
    admin.from("user_roles").select("role").eq("user_id", user.id),
    admin.from("events").select("id").in("status", ["draft", "open"]).maybeSingle(),
  ]);
  if (roles.error) throw new Error(`loadAccess roles failed: ${roles.error.message}`);
  if (event.error) throw new Error(`loadAccess event failed: ${event.error.message}`);
  return {
    user,
    roles: (roles.data ?? []).map((r) => r.role).filter(isRole),
    eventId: event.data?.id ?? null,
  };
}

export function decideAccess(access: Access | null, required: Role): AccessDecision {
  if (!access) return "signin";
  return access.roles.includes(required) ? "allow" : "forbidden";
}
