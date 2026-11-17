'use client';

import type { FaceFrame, StudentSetup } from '@lasuatos/contracts';
import { Camera, ChevronRight, GraduationCap, KeyRound, ListChecks, LogOut, ScanFace, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { endSession, lookupSession, onAccountChanged, type CurrentAccount } from '../../lib/current-account';
import { failureText } from '../../lib/lecture-api';
import { primeResource, revalidate, useResource } from '../../lib/resource';
import { loadStudentSetup, replaceFace } from '../../lib/student-api';
import { initialsOf } from '../../lib/workspace';
import { Button, EmptyState, PageHeader, Section, Sheet } from '../ds';
import { FaceCapture } from '../face-capture';
import { useFeedback } from '../feedback';
import { GuideButton } from '../shell/guide-button';
import { useClock } from '../take-attendance/hooks';
import { DetailsSection, MatricForm, NameForm, StaffNumberForm } from './details';
import { FaceConfirmForm, FaceSection, replaceOpen } from './face';
import { loadSessions } from './api';
import { roleLine, sheetFromHash, signedOutText, type AccountSheet } from './model';
import { PasswordForm } from './password';
import { SESSIONS_KEY, SignIns } from './sessions';
import './account.css';

const SETUP_KEY = 'student:setup';
const FACE_POSES = ['front', 'left', 'right'] as const;
const loadSetup = (signal: AbortSignal) => loadStudentSetup(signal);

type Who = { readonly kind: 'loading' } | { readonly kind: 'unavailable' } | { readonly kind: 'ready'; readonly account: CurrentAccount };

/** The signed-in account, kept current after a change; signed-out visitors go to sign in and come back. */
function useAccount(): [Who, () => void] {
  const [who, setWho] = useState<Who>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () => void lookupSession().then((result) => {
      if (!active) return;
      if (result.kind === 'signed_out') {
        window.location.replace(`/sign-in?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      setWho(result.kind === 'signed_in' ? { kind: 'ready', account: result.account } : { kind: 'unavailable' });
    });
    load();
    const unsubscribe = onAccountChanged(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [attempt]);
  return [who, () => { setWho({ kind: 'loading' }); setAttempt((value) => value + 1); }];
}

const SHEET_TITLES: Record<AccountSheet, string> = {
  name: 'Full name',
  matric: 'Matric number',
  staff: 'Staff number',
  password: 'Change password',
  face: 'Take new photos',
};

/**
 * Account (/account/security), for every kind of account: who you are, your details, your face
 * (students), your password, where you are signed in, and signing out. Like a phone's settings:
 * grouped rows, and each change in its own sheet. `#change-password` and `#face` open those sheets.
 */
export function AccountSettings() {
  const [who, retry] = useAccount();
  const now = useClock('fifteen');
  const account = who.kind === 'ready' ? who.account : null;
  const student = account?.accountType === 'student' ? account : null;
  const setup = useResource(student ? SETUP_KEY : null, loadSetup, { maxAge: 20_000 });
  const dialogs = useFeedback();
  const [sheet, setSheet] = useState<AccountSheet | null>(null);
  const [camera, setCamera] = useState(false);
  const [savingPhotos, setSavingPhotos] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const hashRead = useRef(false);

  const setupData: StudentSetup | null | undefined = student ? setup.data : null;
  const faceShown = Boolean(setupData?.faceRequired && setupData.faceRegistered);
  const startingPassword = Boolean(setupData?.defaultPassword);

  // /account/security#change-password (from the signed-in page and setup reminders) and #face
  // (from the Scan screen's help) open their sheet once the page knows what this account has.
  useEffect(() => {
    if (hashRead.current || !account || (student && setup.loading)) return;
    hashRead.current = true;
    const wanted = sheetFromHash(window.location.hash);
    if (!wanted) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    if (wanted === 'face' && !faceShown) return;
    window.setTimeout(() => setSheet(wanted), 0);
  }, [account, student, setup.loading, faceShown]);

  const closeSheet = useCallback(() => setSheet(null), []);
  const cancelCamera = useCallback(() => setCamera(false), []);
  const openCamera = useCallback(() => {
    setSheet(null);
    setCamera(true);
  }, []);
  const captured = useCallback(async (frames: FaceFrame[]) => {
    setCamera(false);
    setSavingPhotos(true);
    try {
      const result = await replaceFace(frames);
      const current = setup.data;
      if (current) primeResource(SETUP_KEY, { ...current, faceEnrolledAt: result.enrolledAt, faceReplaceAllowedUntil: null });
      dialogs.toast('New face photos saved. They’re used from your next check-in.');
    } catch (caught) {
      dialogs.toast(failureText(caught, 'Your new photos were not saved. Try again.'), 'error');
      setup.reload();
    } finally {
      setSavingPhotos(false);
    }
  }, [dialogs, setup]);

  async function signOut() {
    const sure = await dialogs.confirm({ title: 'Sign out of LASUATOS?', body: 'You’ll need your password to sign in again on this device.', confirmLabel: 'Sign out', tone: 'danger' });
    if (!sure) return;
    setSigningOut(true);
    await endSession();
    window.location.assign('/');
  }

  if (who.kind === 'unavailable') {
    return (
      <div className="acs">
        <PageHeader title="Account" />
        <EmptyState error title="We couldn’t reach LASUATOS" message="Check your connection and try again." action={<Button variant="tinted" onClick={retry}>Try again</Button>} />
      </div>
    );
  }
  if (!account) return <AccountSkeleton />;

  return (
    <div className="acs">
      <PageHeader title="Account" actions={<GuideButton page="/account/security" label="Your account" />} />

      <IdentityCard account={account} setup={setupData} />

      {setupData && !setupData.complete ? (
        <Link className="acs-attention is-tint" href="/account/setup">
          <span className="acs-attention-icon" aria-hidden="true">{setupData.classList ? <ScanFace size={20} strokeWidth={2} /> : <ListChecks size={20} strokeWidth={2} />}</span>
          <span className="acs-attention-text">
            <strong>{setupData.classList ? 'Finish setting up to mark attendance' : 'Ask your HOC to add you to the class list'}</strong>
            <span>{setupData.classList
              ? `${setupData.emailVerified || setupData.vouched ? 'Register your face' : `Confirm your ${setupData.numberKind === 'jamb' ? '' : 'LASU '}email${setupData.faceRequired && !setupData.faceRegistered ? ' and register your face' : ''}`}. It takes about a minute.`
              : 'Marking attendance needs your face, which you register once your name is on your class list.'}</span>
          </span>
          <ChevronRight size={18} strokeWidth={2.4} aria-hidden="true" />
        </Link>
      ) : null}
      {setupData?.complete && setupData.numberKind === 'jamb' ? (
        <Link className="acs-attention is-tint" href="/account/setup?add=matric">
          <span className="acs-attention-icon" aria-hidden="true"><GraduationCap size={20} strokeWidth={2} /></span>
          <span className="acs-attention-text">
            <strong>Got your matric number?</strong>
            <span>Add it with your LASU email. Your attendance, courses and face move with you.</span>
          </span>
          <ChevronRight size={18} strokeWidth={2.4} aria-hidden="true" />
        </Link>
      ) : null}
      {startingPassword ? (
        <button className="acs-attention is-warning" type="button" onClick={() => setSheet('password')}>
          <span className="acs-attention-icon" aria-hidden="true"><TriangleAlert size={20} strokeWidth={2} /></span>
          <span className="acs-attention-text">
            <strong>Change your starting password</strong>
            <span>LASU + matric + SURNAME is easy to guess. Choose one only you know.</span>
          </span>
          <ChevronRight size={18} strokeWidth={2.4} aria-hidden="true" />
        </button>
      ) : null}

      <DetailsSection account={account} setup={setupData} onEdit={setSheet} />

      {faceShown && setupData ? (
        <FaceSection setup={setupData} now={now} onStart={() => setSheet('face')} onCamera={openCamera} />
      ) : null}
      {savingPhotos ? <p className="acs-saving" role="status">Checking your new photos…</p> : null}

      <Section title="Password" id="acs-password" footer="Changing it signs you out everywhere except here.">
        <ul className="ds-list has-leading">
          <li>
            <button className="ds-row acs-action" type="button" onClick={() => setSheet('password')}>
              <span className="ds-row-leading" aria-hidden="true"><KeyRound size={18} strokeWidth={2} /></span>
              <span className="ds-row-body"><span className="ds-row-title">Change password</span></span>
              <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </li>
        </ul>
      </Section>

      <SignIns now={now} />

      <ul className="ds-list acs-signout">
        <li>
          <button className="ds-row" type="button" onClick={() => void signOut()} disabled={signingOut}>
            <LogOut size={18} strokeWidth={2.2} aria-hidden="true" />
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </li>
      </ul>

      <Sheet open={sheet !== null} onClose={closeSheet} title={sheet ? SHEET_TITLES[sheet] : ''}>
        {sheet === 'name' ? <NameForm account={account} onDone={closeSheet} /> : null}
        {sheet === 'matric' && student ? <MatricForm account={student} onDone={closeSheet} /> : null}
        {sheet === 'staff' ? <StaffNumberForm onDone={closeSheet} /> : null}
        {sheet === 'password' ? (
          <PasswordForm
            starting={startingPassword}
            onChanged={(count) => {
              closeSheet();
              dialogs.toast(count ? `Password changed. ${signedOutText(count)}` : 'Password changed.');
              if (setup.data) primeResource(SETUP_KEY, { ...setup.data, defaultPassword: false });
              revalidate(SESSIONS_KEY, loadSessions, 0);
            }}
          />
        ) : null}
        {sheet === 'face' ? (
          replaceOpen(setupData, now)
            ? <FaceReady until={setupData.faceReplaceAllowedUntil} onCamera={openCamera} />
            : (
              <FaceConfirmForm
                onConfirmed={(until) => { if (setup.data) primeResource(SETUP_KEY, { ...setup.data, faceReplaceAllowedUntil: until }); }}
                onCamera={openCamera}
              />
            )
        ) : null}
      </Sheet>

      {camera ? <FaceCapture poses={FACE_POSES} title="Take new photos" review onDone={(frames) => void captured(frames)} onCancel={cancelCamera} /> : null}
    </div>
  );
}

/** The sheet when the new-photos window is already open (they came back within it). */
function FaceReady({ until, onCamera }: Readonly<{ until: string; onCamera: () => void }>) {
  const time = new Intl.DateTimeFormat('en-NG', { hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Lagos' }).format(new Date(until));
  return (
    <div className="acs-form">
      <p className="acs-step-text"><Camera size={17} strokeWidth={2.2} aria-hidden="true" /> You’re confirmed until {time}. Three photos, like when you registered: straight on, then turned left and right. Face a window or a light.</p>
      <Button size="lg" block icon={<Camera size={18} aria-hidden="true" />} onClick={onCamera}>Open the camera</Button>
    </div>
  );
}

/** Who this is, at the top: initials, name, and what they are here. */
function IdentityCard({ account, setup }: Readonly<{ account: CurrentAccount; setup: StudentSetup | null | undefined }>) {
  const extra = account.accountType === 'student' && setup?.classList
    ? `${setup.classList.levelLabel} · ${setup.classList.departmentName}`
    : null;
  return (
    <div className="ds-card acs-identity">
      <span className="acs-avatar" aria-hidden="true">{initialsOf(account.displayName)}</span>
      <div className="acs-identity-text">
        <p className="acs-identity-name">{account.displayName}</p>
        <p className="acs-identity-role">{roleLine(account)}{extra ? <> · {extra}</> : null}</p>
      </div>
    </div>
  );
}

function AccountSkeleton() {
  return (
    <div className="acs" role="status" aria-label="Loading your account">
      <div className="ds-page-header" aria-hidden="true"><span className="ds-skeleton" style={{ width: 160, height: 34 }} /></div>
      <div className="ds-card acs-identity" aria-hidden="true">
        <span className="acs-avatar ds-skeleton" />
        <div className="acs-identity-text">
          <span className="ds-skeleton" style={{ width: '60%', height: 20 }} />
          <span className="ds-skeleton" style={{ width: '40%', height: 14, marginTop: 8 }} />
        </div>
      </div>
      {[3, 1, 2].map((rows, index) => (
        <div className="ds-section" key={index} aria-hidden="true">
          <div className="ds-section-head"><span className="ds-skeleton" style={{ width: 130, height: 20 }} /></div>
          <div className="ds-list">
            {Array.from({ length: rows }, (_, row) => (
              <div className="ds-row" key={row}><span className="ds-row-body"><span className="ds-skeleton" style={{ width: '30%', height: 12 }} /><span className="ds-skeleton" style={{ width: '62%', height: 16, marginTop: 6 }} /></span></div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
