'use client';

import type { StudentSetup } from '@lasuatos/contracts';
import { ArrowRight, GraduationCap, KeyRound, ListChecks, MailCheck, ScanFace } from 'lucide-react';
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
  // Opened with the HOC's setup code and face registered: attendance works; the email is still owed.
  if (setup.vouched && !setup.emailVerified && setup.classList && (setup.faceRegistered || !setup.faceRequired)) {
    return (
      <Link className="sx-setup-card" href="/account/setup">
        <MailCheck size={22} aria-hidden="true" />
        <span>
          <strong>Confirm your LASU email</strong>
          <small>You can mark attendance. Until you confirm your LASU email, anyone who confirms it can take this account over.</small>
        </span>
        <ArrowRight size={18} aria-hidden="true" />
      </Link>
    );
  }
  if (!setup.complete && setup.classList) {
    const email = setup.numberKind === 'jamb' ? 'email' : 'LASU email';
    const missing = setup.vouched || setup.emailVerified
      ? 'Register your face'
      : (setup.faceRequired ? `Confirm your ${email} and register your face` : `Confirm your ${email}`);
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
  if (setup.complete && setup.numberKind === 'jamb' && !setup.defaultPassword) {
    return (
      <Link className="sx-setup-card is-quiet" href="/account/setup?add=matric">
        <GraduationCap size={20} aria-hidden="true" />
        <span>
          <strong>Got your matric number?</strong>
          <small>Add it with your LASU email. Your attendance moves with you.</small>
        </span>
        <ArrowRight size={18} aria-hidden="true" />
      </Link>
    );
  }
  if (setup.defaultPassword) {
    return (
      <Link className="sx-setup-card is-quiet" href="/account/security#change-password">
        <KeyRound size={20} aria-hidden="true" />
        <span>
          <strong>Change your starting password</strong>
          <small>LASU + {setup.jambNumber ? 'your number' : 'matric'} + SURNAME is easy to guess. Choose one only you know.</small>
        </span>
        <ArrowRight size={18} aria-hidden="true" />
      </Link>
    );
  }
  return null;
}
