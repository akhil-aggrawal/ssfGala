import type { Metadata } from "next";
import { Suspense } from "react";
import { signInWithGoogle } from "@/lib/auth/actions";
import { safeNextPath } from "@/lib/auth/next-path";

export const metadata: Metadata = { title: "Sign in — SSF Gala" };

type SearchParams = PageProps<"/signin">["searchParams"];

async function SignInForm({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const raw = Array.isArray(params.next) ? params.next[0] : params.next;
  const next = safeNextPath(raw);
  return (
    <>
      {params.error !== undefined && (
        <p role="alert" className="signin__error">
          Sign-in did not finish. Please try again.
        </p>
      )}
      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <button type="submit" className="button button--primary">
          Sign in with Google
        </button>
      </form>
    </>
  );
}

export default function SignInPage({ searchParams }: PageProps<"/signin">) {
  return (
    <main className="signin">
      <h1>Sign in</h1>
      <p>Sign in with your Google account to buy tickets, sponsor a table or register as a guest.</p>
      <Suspense>
        <SignInForm searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
