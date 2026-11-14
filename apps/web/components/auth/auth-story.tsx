import { Check, KeyRound, Laptop, LockKeyhole, Mail, MapPinned, ScanFace, Smartphone, TimerReset, UserRoundSearch } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { MockQr } from '../home/mock-qr';

/**
 * The looping stories on the navy panel of the account pages. Each is three
 * frames that play for four seconds each (see `.au-frame` in auth.css), in
 * step with the three beats written under it. Purely decorative: the beats
 * carry the meaning in text, so the pictures are hidden from screen readers.
 */
export const STORIES = {
  'sign-in': {
    headline: 'Scan. Look. You’re on the register.',
    beats: ['Scan the QR in class', 'Look at the camera', 'You’re on the register'],
  },
  'sign-up': {
    headline: 'Two minutes now. Two seconds at every class.',
    beats: ['Find your name', 'A code to your LASU email', 'Three quick photos'],
  },
  'forgot-password': {
    headline: 'Locked out? You’re one link away.',
    beats: ['Your email or matric', 'A link to your inbox', 'A new password'],
  },
  'reset-password': {
    headline: 'A new password, and only you stay signed in.',
    beats: ['Choose a new password', 'Old devices signed out', 'Sign in again'],
  },
  'verify-email': {
    headline: 'One tap and your email is confirmed.',
    beats: ['Open the email', 'Tap confirm', 'You’re confirmed'],
  },
  'accept-invitation': {
    headline: 'Put up the QR. The register fills itself in.',
    beats: ['Accept the invitation', 'Show the QR in class', 'Every check-in verified'],
  },
} as const satisfies Record<string, { headline: string; beats: readonly [string, string, string] }>;

export type StoryName = keyof typeof STORIES;

const frame = (index: number) => ({ '--f': index }) as CSSProperties;
const delay = (index: number) => ({ '--d': index }) as CSSProperties;

function Frame({ index, children }: Readonly<{ index: number; children: ReactNode }>) {
  return <div className="au-frame" style={frame(index)}>{children}</div>;
}

/** A projector screen with a code that "scans". */
function QrScreen({ seed, label }: Readonly<{ seed: number; label: string }>) {
  return (
    <div className="au-screen">
      <div className="au-screen-qr">
        <MockQr seed={seed} className="au-qr" />
        <span className="au-viewfinder" />
        <span className="au-scanline" />
      </div>
      <span className="au-screen-label"><TimerReset size={14} />{label}</span>
    </div>
  );
}

/** The circular face guide with a filling ring, as on the check-in camera. */
function FaceRing({ chip }: Readonly<{ chip: string }>) {
  return (
    <div className="au-face">
      <svg className="au-face-ring" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="54" className="au-face-track" />
        <circle cx="60" cy="60" r="54" className="au-face-fill" pathLength={100} />
      </svg>
      <svg className="au-face-person" viewBox="0 0 120 120">
        <circle cx="60" cy="50" r="19" />
        <path d="M24 112c4-22 18-34 36-34s32 12 36 34" />
      </svg>
      <span className="au-chip is-ok au-face-chip"><Check size={13} strokeWidth={3} />{chip}</span>
    </div>
  );
}

function PasswordCard({ label, note }: Readonly<{ label: string; note: string }>) {
  return (
    <div className="au-card au-pass">
      <span className="au-label">{label}</span>
      <span className="au-input au-pass-dots">
        {Array.from({ length: 10 }, (_, index) => <i key={index} style={delay(index)} />)}
      </span>
      <span className="au-strength"><i /></span>
      <span className="au-pass-note"><KeyRound size={14} />{note}</span>
    </div>
  );
}

function Seal({ title, note }: Readonly<{ title: string; note: string }>) {
  return (
    <div className="au-seal">
      <span className="au-seal-mark"><Check size={34} strokeWidth={2.6} /></span>
      <strong>{title}</strong>
      <small>{note}</small>
    </div>
  );
}

function SignInStory() {
  return (
    <>
      <Frame index={0}><QrScreen seed={11} label="MEE 301 · new code every 30 s" /></Frame>
      <Frame index={1}><FaceRing chip="It’s you · liveness confirmed" /></Frame>
      <Frame index={2}>
        <div className="au-card au-register">
          <div className="au-register-head"><b>MEE 301 register</b><span>10:00 · Lecture Theatre 2</span></div>
          <div className="au-row is-new">
            <span className="au-avatar">AO</span>
            <span className="au-row-copy"><b>Odejobi A.</b><small>Inside the hall · ± 9 m</small></span>
            <span className="au-tick"><Check size={14} strokeWidth={3} /></span>
          </div>
          <div className="au-row">
            <span className="au-avatar">TA</span>
            <span className="au-row-copy"><b>Adeyemi T.</b><small>10:01</small></span>
            <span className="au-tick"><Check size={14} strokeWidth={3} /></span>
          </div>
          <div className="au-row">
            <span className="au-avatar">CO</span>
            <span className="au-row-copy"><b>Okafor C.</b><small>10:01</small></span>
            <span className="au-tick"><Check size={14} strokeWidth={3} /></span>
          </div>
        </div>
      </Frame>
    </>
  );
}

function SignUpStory() {
  return (
    <>
      <Frame index={0}>
        <div className="au-card au-lookup">
          <span className="au-label">Matric number</span>
          <span className="au-input"><span className="au-typed">250211184</span><i className="au-caret" /></span>
          <div className="au-found">
            <span className="au-found-icon"><UserRoundSearch size={18} /></span>
            <span className="au-row-copy"><b>ODEJOBI Abraham O.</b><small>Mechanical Engineering · 200 Level</small></span>
          </div>
        </div>
      </Frame>
      <Frame index={1}>
        <div className="au-card au-mail">
          <div className="au-mail-head">
            <span className="au-found-icon"><Mail size={18} /></span>
            <span className="au-row-copy"><b>Your LASUATOS code</b><small>…@st.lasu.edu.ng</small></span>
          </div>
          <div className="au-otp">
            {['4', '8', '1', '9', '0', '2'].map((digit, index) => <span key={index} style={delay(index)}><b>{digit}</b></span>)}
          </div>
          <small className="au-mail-note">Works for 15 minutes</small>
        </div>
      </Frame>
      <Frame index={2}>
        <div className="au-poses-wrap">
          <FaceRing chip="Face registered" />
          <div className="au-poses">
            {['Front', 'Left', 'Right'].map((pose, index) => (
              <span key={pose} style={delay(index)}><Check size={12} strokeWidth={3} />{pose}</span>
            ))}
          </div>
        </div>
      </Frame>
    </>
  );
}

function ForgotStory() {
  return (
    <>
      <Frame index={0}>
        <div className="au-card au-lookup">
          <span className="au-label">Email or matric number</span>
          <span className="au-input"><span className="au-typed">250211184</span><i className="au-caret" /></span>
          <span className="au-fake-button">Email me a reset link</span>
        </div>
      </Frame>
      <Frame index={1}>
        <div className="au-card au-mail">
          <div className="au-mail-head">
            <span className="au-found-icon"><Mail size={18} /></span>
            <span className="au-row-copy"><b>Reset your password</b><small>From LASUATOS · just now</small></span>
          </div>
          <span className="au-fake-button is-tap">Choose a new password</span>
          <small className="au-mail-note">Works once · expires in 30 minutes</small>
        </div>
      </Frame>
      <Frame index={2}><PasswordCard label="New password" note="Saved. You’re signed in." /></Frame>
    </>
  );
}

function ResetStory() {
  const devices = [
    { icon: Smartphone, name: 'This phone', meta: 'Signed in now', keep: true },
    { icon: Laptop, name: 'Library computer', meta: 'Last week' },
    { icon: Smartphone, name: 'Old phone', meta: 'In March' },
  ];
  return (
    <>
      <Frame index={0}><PasswordCard label="New password" note="At least 10 characters" /></Frame>
      <Frame index={1}>
        <div className="au-card au-devices">
          <div className="au-register-head"><b>Signed-in devices</b><span>Your account</span></div>
          {devices.map(({ icon: Icon, name, meta, keep }, index) => (
            <div className={`au-row${keep ? ' is-keep' : ' is-out'}`} key={name} style={delay(index)}>
              <span className="au-avatar"><Icon size={16} /></span>
              <span className="au-row-copy"><b>{name}</b><small>{meta}</small></span>
              <span className="au-state"><i>Signed in</i><i>Signed out</i></span>
            </div>
          ))}
        </div>
      </Frame>
      <Frame index={2}><Seal title="Password changed" note="We emailed you a confirmation" /></Frame>
    </>
  );
}

function VerifyStory() {
  return (
    <>
      <Frame index={0}>
        <div className="au-card au-inbox">
          <div className="au-register-head"><b>Inbox</b><span>…@st.lasu.edu.ng</span></div>
          <div className="au-row is-new">
            <span className="au-avatar is-brand">L</span>
            <span className="au-row-copy"><b>LASUATOS</b><small>Confirm your email address</small></span>
            <span className="au-dot" />
          </div>
          <div className="au-row is-muted">
            <span className="au-avatar">P</span>
            <span className="au-row-copy"><b>LASU Portal</b><small>Course registration</small></span>
          </div>
          <div className="au-row is-muted">
            <span className="au-avatar">S</span>
            <span className="au-row-copy"><b>Student Affairs</b><small>Harmattan semester</small></span>
          </div>
        </div>
      </Frame>
      <Frame index={1}>
        <div className="au-card au-mail">
          <div className="au-mail-head">
            <span className="au-found-icon"><Mail size={18} /></span>
            <span className="au-row-copy"><b>Confirm your email</b><small>From LASUATOS</small></span>
          </div>
          <span className="au-fake-button is-tap">Confirm email address</span>
          <small className="au-mail-note">The link works once, for 30 minutes</small>
        </div>
      </Frame>
      <Frame index={2}><Seal title="Email confirmed" note="Your account is ready" /></Frame>
    </>
  );
}

function StaffStory() {
  const checks = [
    { icon: LockKeyhole, label: 'Their own account', tag: 'LASU email' },
    { icon: ScanFace, label: 'Their own face', tag: 'Liveness' },
    { icon: MapPinned, label: 'Inside the hall', tag: '± 9 m' },
    { icon: TimerReset, label: 'A fresh code', tag: '30 s' },
  ];
  return (
    <>
      <Frame index={0}>
        <div className="au-card au-ticket">
          <span className="au-ticket-kicker">Staff invitation</span>
          <b className="au-ticket-role">Lecturer</b>
          <span className="au-ticket-scope">Mechanical Engineering</span>
          <span className="au-ticket-rule" />
          <span className="au-ticket-meta"><span>Works once</span><span>Valid 7 days</span></span>
        </div>
      </Frame>
      <Frame index={1}><QrScreen seed={23} label="Changes every 30 seconds" /></Frame>
      <Frame index={2}>
        <div className="au-card au-checks">
          {checks.map(({ icon: Icon, label, tag }, index) => (
            <div className="au-check" key={label} style={delay(index)}>
              <span className="au-check-icon"><Icon size={16} /></span>
              <b>{label}</b>
              <span className="au-check-tag">{tag}</span>
              <span className="au-tick"><Check size={13} strokeWidth={3} /></span>
            </div>
          ))}
        </div>
      </Frame>
    </>
  );
}

export function AuthStory({ story }: Readonly<{ story: StoryName }>) {
  return (
    <div className="au-scene" aria-hidden="true">
      {story === 'sign-in' ? <SignInStory /> : null}
      {story === 'sign-up' ? <SignUpStory /> : null}
      {story === 'forgot-password' ? <ForgotStory /> : null}
      {story === 'reset-password' ? <ResetStory /> : null}
      {story === 'verify-email' ? <VerifyStory /> : null}
      {story === 'accept-invitation' ? <StaffStory /> : null}
    </div>
  );
}
