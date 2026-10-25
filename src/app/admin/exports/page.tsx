import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { REPORT_KEYS, REPORT_TITLES as TITLES } from "@/lib/admin/exports";
import { requireRole } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Exports — SSF Gala admin" };

async function Downloads() {
  await requireRole("admin", "/admin/exports");
  return (
    <>
      <p>
        Files hold guest names and emails. Each download is recorded in the audit log.{" "}
        <Link href="/admin/reports">View reports</Link> on screen.
      </p>
      <p>
        <a href="/admin/exports/reports.xlsx" download>
          Download Excel
        </a>{" "}
        (all reports, one sheet each)
      </p>
      <ul>
        {REPORT_KEYS.map((key) => (
          <li key={key}>
            {TITLES[key]}:{" "}
            <a href={`/admin/exports/${key}.csv`} download aria-label={`Download CSV: ${TITLES[key]}`}>
              Download CSV
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function Page() {
  return (
    <>
      <h1>Exports</h1>
      <Suspense fallback={<p>Checking access…</p>}>
        <Downloads />
      </Suspense>
    </>
  );
}
