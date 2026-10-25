// Sponsor guest edits (issue #23): form parsing and plain-words errors for
// sponsor_update_guest / sponsor_remove_guest.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type GuestEdit = { id: string; full_name: string; email: string };

export function parseGuestId(raw: string): string | null {
  return UUID.test(raw) ? raw : null;
}

export function parseGuestEdit(
  formData: FormData,
): { ok: true; value: GuestEdit } | { ok: false; error: string } {
  const id = parseGuestId(formData.get("id")?.toString() ?? "");
  if (!id) return { ok: false, error: "Unknown guest." };
  const full_name = (formData.get("full_name")?.toString() ?? "").trim();
  const email = (formData.get("email")?.toString() ?? "").trim();
  if (full_name === "" || full_name.length > 200) return { ok: false, error: "Enter the guest's name." };
  if (!EMAIL.test(email) || email.length > 320) return { ok: false, error: "Enter a valid email address." };
  return { ok: true, value: { id, full_name, email } };
}

export const PAID_GUEST_TEXT = "This guest has paid, so they can't be removed. Contact the gala team for help.";

export function guestErrorMessage(error: { code?: string; message: string }): string {
  if (error.code === "P0001" && error.message.includes("sponsor_guest_paid")) return PAID_GUEST_TEXT;
  if (error.code === "55000") return "This gala is archived and read-only. Nothing was saved.";
  if (error.code === "P0002") return "That guest is no longer on your table. Nothing was saved.";
  if (error.code === "22023") return "Enter the guest's name and email. Nothing was saved.";
  return "The change could not be saved. Try again.";
}
