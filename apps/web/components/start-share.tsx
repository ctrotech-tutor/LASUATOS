// Share row for the student guide page: WhatsApp (where students actually
// share things) plus a copy-link button. Client-side because it needs the
// page URL and the clipboard.
'use client';

import { Check, Link2 } from 'lucide-react';
import { useEffect, useState } from 'react';

const SHARE_TEXT =
  'New to LASUATOS? This 3-minute video shows you everything: opening your account, registering your face, and marking attendance in class.';

export function StartShare() {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2200);
    return () => window.clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    const url = `${window.location.origin}/start`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Older browsers: select a temporary input so the user can copy manually.
      const input = document.createElement('input');
      input.value = url;
      document.body.append(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    setCopied(true);
  };

  const whatsapp = () => {
    const url = `${window.location.origin}/start`;
    window.open(`https://wa.me/?text=${encodeURIComponent(`${SHARE_TEXT} ${url}`)}`, '_blank', 'noopener');
  };

  return (
    <div className="sg-share" aria-label="Share this guide">
      <span className="sg-share-label">Send it to your class:</span>
      <div className="sg-share-btns">
        <button type="button" className="sg-share-btn sg-share-wa" onClick={whatsapp}>
          <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="M12.04 2a9.9 9.9 0 0 0-8.5 14.96L2 22l5.2-1.5A9.9 9.9 0 1 0 12.04 2Zm0 1.8a8.1 8.1 0 1 1-4.13 15.06l-.3-.18-3.06.88.9-2.98-.2-.31a8.1 8.1 0 0 1 6.79-12.47Zm-3.1 4.06c-.18 0-.47.07-.72.34-.24.27-.94.92-.94 2.24 0 1.32.96 2.6 1.1 2.78.13.18 1.87 3 4.6 4.08 2.28.9 2.77.72 3.27.68.5-.05 1.6-.66 1.83-1.29.22-.63.22-1.17.15-1.29-.06-.11-.24-.18-.5-.31-.27-.13-1.61-.8-1.86-.89-.25-.09-.43-.13-.61.14-.18.27-.7.88-.86 1.06-.16.18-.31.2-.58.07a7.2 7.2 0 0 1-2.12-1.31 7.9 7.9 0 0 1-1.47-1.83c-.15-.27-.02-.41.12-.54.12-.12.27-.31.4-.47.14-.16.19-.27.28-.47.1-.15.05-.29-.02-.42-.08-.13-.6-1.46-.83-2-.2-.48-.42-.42-.6-.42l-.34-.01Z"/></svg>
          WhatsApp
        </button>
        <button type="button" className="sg-share-btn" onClick={copy} aria-live="polite">
          {copied ? <Check size={17} aria-hidden="true" /> : <Link2 size={17} aria-hidden="true" />}
          {copied ? 'Copied!' : 'Copy link'}
        </button>
      </div>
    </div>
  );
}
