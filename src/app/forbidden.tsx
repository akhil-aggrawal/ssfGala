import Link from "next/link";

// Rendered by forbidden(): a signed-in user without the role a page needs.
export default function Forbidden() {
  return (
    <main className="signin">
      <h1>403 — Not allowed</h1>
      <p>Your account does not have access to this page.</p>
      <Link href="/" className="button button--primary">
        Back to the gala
      </Link>
    </main>
  );
}
