import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { Suspense } from "react";
import { signInWithGoogle } from "@/lib/auth/actions";
import { getSessionUser } from "@/lib/auth/session";
import { invitePath, loadInvite } from "@/lib/invite/landing";
import { registerPath } from "@/lib/invite/register";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

// The token is a secret: keep invite pages out of search results.
export const metadata: Metadata = {
  title: "You're Invited — SSF Gala",
  robots: { index: false, follow: false },
};

type Params = PageProps<"/invite/[token]">["params"];

async function Invitation({ params }: { params: Params }) {
  await connection();
  const { token } = await params;
  const invite = await loadInvite(createSupabaseAdminClient(), token);

  if (invite.kind === "invalid") {
    return (
      <section className="invite__notice" aria-labelledby="invite-invalid">
        <h1 id="invite-invalid">This invitation link is not valid</h1>
        <p>
          Check that you copied the whole link, or ask the sponsor who invited you to send it again. You can also contact
          the Small Steps Foundation gala team for help.
        </p>
      </section>
    );
  }

  const intro = (
    <>
      <h1>You&rsquo;re Invited</h1>
      <p className="invite__lede">
        <strong className="invite__sponsor">{invite.sponsorName}</strong> invites you to join their table at{" "}
        {invite.eventName}.
      </p>
      <p className="invite__tier">
        Seating tier: <strong>{invite.tier}</strong>
      </p>
    </>
  );

  if (invite.kind === "closed") {
    return (
      <>
        {intro}
        <p className="invite__closed" role="status">
          Registration for this gala is closed. Please contact the sponsor who invited you.
        </p>
      </>
    );
  }

  const user = await getSessionUser();
  return (
    <>
      {intro}
      {user ? (
        <>
          <p className="invite__signed-in">Signed in as {user.email ?? "your Google account"}.</p>
          <Link href={registerPath(token)} className="button button--primary">
            Register Guests
          </Link>
        </>
      ) : (
        <form action={signInWithGoogle} className="invite__signin">
          <p>Sign in with Google to register for this table. You will come back to this page.</p>
          <input type="hidden" name="next" value={invitePath(token)} />
          <button type="submit" className="button button--primary">
            Sign in with Google
          </button>
        </form>
      )}
    </>
  );
}

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <main className="invite">
      <Suspense fallback={<p>Loading your invitation…</p>}>
        <Invitation params={params} />
      </Suspense>
    </main>
  );
}
