import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { signInWithGoogle } from "@/lib/auth/actions";
import { getSessionUser } from "@/lib/auth/session";
import { invitePath, loadInvite } from "@/lib/invite/landing";
import { MAX_GUESTS, registerPath } from "@/lib/invite/register";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { GuestForm } from "./guest-form";

// The token is a secret: keep invite pages out of search results.
export const metadata: Metadata = {
  title: "Register Guests — SSF Gala",
  robots: { index: false, follow: false },
};

type Params = PageProps<"/invite/[token]/register">["params"];

async function Registration({ params }: { params: Params }) {
  await connection();
  const { token } = await params;
  const invite = await loadInvite(createSupabaseAdminClient(), token);

  if (invite.kind === "invalid") {
    return (
      <p className="tickets__closed" role="status">
        This invitation link is not valid. Ask the sponsor who invited you to send it again.
      </p>
    );
  }
  if (invite.kind === "closed") {
    return (
      <p className="tickets__closed" role="status">
        Registration for this gala is closed. Please contact the sponsor who invited you.
      </p>
    );
  }

  const intro = (
    <p className="tickets__summary">
      {invite.sponsorName}&rsquo;s table · Seating tier: {invite.tier} ·{" "}
      <Link href={invitePath(token)}>Invitation</Link>
    </p>
  );

  const user = await getSessionUser();
  if (!user) {
    return (
      <>
        {intro}
        <form action={signInWithGoogle} className="invite__signin">
          <p>Sign in with Google to register. You will come back to this page.</p>
          <input type="hidden" name="next" value={registerPath(token)} />
          <button type="submit" className="button button--primary">
            Sign in with Google
          </button>
        </form>
      </>
    );
  }

  return (
    <>
      {intro}
      <GuestForm token={token} tier={invite.tier} max={MAX_GUESTS} />
    </>
  );
}

export default function RegisterPage({ params }: PageProps<"/invite/[token]/register">) {
  return (
    <main className="tickets">
      <h1>Register Guests</h1>
      <p>Enter a name and email for each attendee. There is nothing to pay.</p>
      <Suspense fallback={<p>Loading…</p>}>
        <Registration params={params} />
      </Suspense>
    </main>
  );
}
