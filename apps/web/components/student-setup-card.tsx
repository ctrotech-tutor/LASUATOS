'use client';

import type { StudentSetup } from '@lasuatos/contracts';
import { ArrowRight, KeyRound, ListChecks, ScanFace } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { loadStudentSetup } from '../lib/student-api';

/**
 * A reminder on the student's home page while their account is not ready to
 * mark attendance (not on a class list, LASU email or face missing), or still
 * uses the starting password. Says nothing when all is done or when the check fails.
 */
export function StudentSetupCard() {
  const [setup, setSetup] = useState<StudentSetup | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadStudentSetup(controller.signal).then(setSetup).catch(() => undefined);
    return () => controller.abort();
  }, []);

  if (!setup) return null;
  if (!setup.complete && setup.classList) {
    const missing = !setup.emailVerified
      ? (setup.faceRequired ? 'Confirm your LASU email and register your face' : 'Confirm your LASU email')
      : 'Register your face';
    return (
      <Link className="sx-setup-card" href="/account/setup">
        <ScanFace size={22} aria-hidden="true" />
        <span>
          <strong>Finish setting up to mark attendance</strong>
          <small>{missing}. It takes about a minute.</small>
        </span>
        <ArrowRight size={18} aria-hidden="true" />
      </Link>
    );
  }
  if (setup.faceRequired && !setup.classList) {
    return (
      <Link className="sx-setup-card" href="/account/setup">
        <ListChecks size={22} aria-hidden="true" />
        <span>
          <strong>Ask your HOC to add you to the class list</strong>
          <small>Marking attendance now needs your face, which you register once your name is on your class list.</small>
        </span>
        <ArrowRight size={18} aria-hidden="true" />
      </Link>
    );
  }
  if (setup.defaultPassword) {
    return (
      <Link className="sx-setup-card is-quiet" href="/account/security">
        <KeyRound size={20} aria-hidden="true" />
        <span>
          <strong>Change your starting password</strong>
          <small>LASU + matric + SURNAME is easy to guess. Choose one only you know.</small>
        </span>
        <ArrowRight size={18} aria-hidden="true" />
      </Link>
    );
  }
  return null;
}
