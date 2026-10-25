"use client";

import { useEffect, useRef, useState } from "react";
import { invitationText, type Invitation } from "@/lib/sponsor/invitation";

// Copy Link and Copy Invitation Email for one table. Only the clipboard is
// used: the app sends nothing. When the browser refuses the clipboard, the
// text is shown selected for a manual copy.
export function TableShare({ tableId, url, invitation }: { tableId: string; url: string; invitation: Invitation }) {
  const [subject, setSubject] = useState(invitation.subject);
  const [body, setBody] = useState(invitation.body);
  const [status, setStatus] = useState("");
  const [manual, setManual] = useState<string | null>(null);
  const manualRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (manual !== null) manualRef.current?.select();
  }, [manual]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setManual(null);
      setStatus("Copied");
    } catch {
      setManual(text);
      setStatus("Copy was blocked. The text below is selected: press Ctrl+C (⌘C on Mac).");
    }
  };

  const subjectId = `invite-subject-${tableId}`;
  const bodyId = `invite-body-${tableId}`;
  const manualId = `invite-manual-${tableId}`;

  return (
    <div className="table-share">
      <div className="table-share__actions">
        <button type="button" onClick={() => copy(url)}>
          Copy Link
        </button>
        <button type="button" onClick={() => copy(invitationText({ subject, body }))}>
          Copy Invitation Email
        </button>
      </div>
      <p role="status" className="table-share__status">
        {status}
      </p>
      {manual !== null && (
        <>
          <label htmlFor={manualId}>Text to copy</label>
          <textarea
            id={manualId}
            ref={manualRef}
            readOnly
            rows={manual.includes("\n") ? 8 : 2}
            value={manual}
            onFocus={(e) => e.currentTarget.select()}
          />
        </>
      )}
      <details className="table-share__preview">
        <summary>Edit invitation</summary>
        <label htmlFor={subjectId}>Subject</label>
        <input id={subjectId} value={subject} onChange={(e) => setSubject(e.target.value)} />
        <label htmlFor={bodyId}>Message</label>
        <textarea id={bodyId} rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
      </details>
    </div>
  );
}
