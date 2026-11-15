'use client';

import { BookOpen } from 'lucide-react';
import { useState } from 'react';
import { useCurrentAccount } from '../../lib/current-account';
import { GuideSheet } from '../guide-sheet';
import { GUIDE_TOPICS } from '../shell/guide';
import type { ShellRole } from '../shell/nav-model';

/** The page's Guide: its own answers first, then every page of the workspace. */
export function GuideButton({ page = '/sessions', label = 'Taking attendance' }: Readonly<{
  /** Whose questions come first: a key of GUIDE_TOPICS. */
  page?: string;
  label?: string;
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
