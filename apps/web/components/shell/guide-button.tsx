'use client';

import { BookOpen } from 'lucide-react';
import { useState } from 'react';
import { useCurrentAccount } from '../../lib/current-account';
import { GuideSheet } from '../guide-sheet';
import { GUIDE_TOPICS } from './guide';
import type { ShellRole } from './nav-model';

/** A page's Guide button: that page's answers first, then every page of the workspace. */
export function GuideButton({ page, label }: Readonly<{
  /** Whose questions come first: a key of GUIDE_TOPICS. */
  page: string;
  /** Heading over the page's answers. */
  label: string;
}>) {
  const [open, setOpen] = useState(false);
  const account = useCurrentAccount();
  const role: ShellRole = account?.accountType === 'administrator' ? 'administrator' : account?.accountType === 'lecturer' ? 'lecturer' : 'student';
  const institutionAdmin = account?.accountType === 'administrator' && account.role === 'institution_administrator';
  return (
    <>
      <button className="ds-icon-btn" type="button" aria-label="Guide" data-tip="Guide" onClick={() => setOpen(true)}>
        <BookOpen size={18} strokeWidth={2.1} aria-hidden="true" />
      </button>
      <GuideSheet
        open={open}
        onClose={() => setOpen(false)}
        role={role}
        institutionAdmin={institutionAdmin}
        topics={GUIDE_TOPICS[page]}
        topicsLabel={label}
      />
    </>
  );
}
