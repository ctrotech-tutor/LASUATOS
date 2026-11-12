'use client';

import { useEffect, useState } from 'react';
import { lookupSession } from '../lib/current-account';
import { homePathFor } from './account-forms';
import { BrandMark } from './brand-mark';

export function LaunchRedirect() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 2500);
    void lookupSession().then((session) => {
      // Signed out: students mostly open the app to scan, so go to the scanner.
      window.location.replace(session.kind === 'signed_in' ? homePathFor(session.account.accountType) : '/a');
    });
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="ui-launch" role="status">
      <BrandMark className="ui-launch-mark" />
      <p>{slow ? 'Waking up the server…' : 'Opening LASUATOS…'}</p>
    </div>
  );
}
