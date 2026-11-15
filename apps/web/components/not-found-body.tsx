'use client';

import { ArrowLeft, ArrowRight, QrCode } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCurrentAccount } from '../lib/current-account';
import { useNameThisPage } from '../lib/page-label';
import { workspaceAction, workspacePath } from '../lib/workspace';

/**
 * What a missing page offers depends on who is looking. Signed in: their own home and a way back,
 * never "Sign in" or a student check-in a lecturer would only be turned away from. Signed out (or
 * not known yet): mark attendance, the home page, help.
 */
export function NotFoundBody() {
  const account = useCurrentAccount();
  const router = useRouter();
  useNameThisPage('Page not found');
  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(account ? workspacePath(account.accountType) : '/');
  };

  if (account) {
    return (
      <>
        <p className="st-lede">The address may be old or mistyped, or the page may have moved. Everything you can open is in your menu.</p>
        <div className="st-actions">
          <Link className="st-btn st-btn-primary" href={workspacePath(account.accountType)}>{workspaceAction(account.accountType)} <ArrowRight size={17} aria-hidden="true" /></Link>
          <button className="st-btn st-btn-ghost" type="button" onClick={goBack}><ArrowLeft size={17} aria-hidden="true" /> Go back</button>
        </div>
        <p className="st-links">Still stuck? The <Link href="/help">Help centre</Link> explains every page.</p>
      </>
    );
  }

  return (
    <>
      <p className="st-lede">The address may be old or mistyped. If you came here from a QR code, scan the screen again or type the code shown under it.</p>
      <div className="st-actions">
        <Link className="st-btn st-btn-primary" href="/a"><QrCode size={18} aria-hidden="true" /> Mark attendance</Link>
        <Link className="st-btn st-btn-ghost" href="/">Go to the home page <ArrowRight size={17} aria-hidden="true" /></Link>
      </div>
      <p className="st-links">
        Or try the <Link href="/help">Help centre</Link>
        {account === null ? <> or <Link href="/sign-in">Sign in</Link></> : null}.
      </p>
    </>
  );
}
