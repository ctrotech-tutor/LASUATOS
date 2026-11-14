'use client';

import {
  CONTACT_MESSAGE_MAX,
  CONTACT_MESSAGE_MIN,
  CONTACT_PRIVACY_REQUEST_LABELS,
  CONTACT_PRIVACY_REQUESTS,
  CONTACT_ROLE_LABELS,
  CONTACT_ROLES,
  CONTACT_TOPIC_LABELS,
  type ContactPrivacyRequest,
  type ContactRole,
  type ContactTopic,
} from '@lasuatos/contracts';
import {
  ArrowRight,
  Bug,
  Building2,
  Check,
  ClipboardList,
  Copy,
  IdCard,
  KeyRound,
  LifeBuoy,
  MessageSquareText,
  ScanFace,
  Send,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { sendContactMessage } from '../../lib/contact-api';
import { useCurrentAccount } from '../../lib/current-account';
import { failureText } from '../../lib/lecture-api';
import { NumberField } from '../ui/number-field';
import { Select } from '../ui/select';
import { SwitchField } from '../ui/switch';

/* ------------------------------------------------------------------ */
/* The contact page: first "what is it about?", then either the person */
/* in the department who can fix it today, or a message to the team.   */
/* ------------------------------------------------------------------ */

type LocalTopic = 'entry' | 'name' | 'face';
type Choice = LocalTopic | ContactTopic;

const LOCAL: ReadonlyArray<{
  id: LocalTopic;
  title: string;
  icon: typeof ScanFace;
  who: string;
  why: string;
  bring: readonly string[];
  help: { href: string; label: string };
}> = [
  {
    id: 'entry',
    title: 'An attendance entry is missing or wrong',
    icon: ClipboardList,
    who: 'The lecturer or class rep who took that attendance',
    why: 'They can see the session and add, remove or fix an entry straight away. Nobody else can change it for them.',
    bring: ['The course code and the date of the lecture', 'Your matric number', 'What you saw (for example “Outside the venue”)'],
    help: { href: '/help#students', label: 'Attendance answers for students' },
  },
  {
    id: 'name',
    title: 'My name or matric number is wrong',
    icon: IdCard,
    who: 'Your HOC (class rep)',
    why: 'They keep your class list, so they can correct it and, if you can’t reach your LASU email, give you a one-time setup code.',
    bring: ['Your matric number', 'Your name exactly as the university has it'],
    help: { href: '/help#q-matric', label: 'Matric number not found' },
  },
  {
    id: 'face',
    title: 'My face check fails, or my account is locked',
    icon: ScanFace,
    who: 'Your department’s or faculty’s LASUATOS administrator',
    why: 'They can release a locked account or clear your face photos so you can take new ones. Ask your HOC who that is.',
    bring: ['Your matric number', 'When it started, and what the screen said'],
    help: { href: '/help#q-face-fail', label: 'Face check failing' },
  },
];

const TEAM: ReadonlyArray<{ id: ContactTopic; title: string; text: string; icon: typeof ScanFace }> = [
  { id: 'adoption', title: CONTACT_TOPIC_LABELS.adoption, text: 'HODs, deans, lecturers and ICT: set up a department or faculty.', icon: Building2 },
  { id: 'problem', title: CONTACT_TOPIC_LABELS.problem, text: 'A page, a button or a check that misbehaves.', icon: Bug },
  { id: 'privacy', title: CONTACT_TOPIC_LABELS.privacy, text: 'A copy of your data, a correction, or deleting your face data.', icon: ShieldCheck },
  { id: 'other', title: CONTACT_TOPIC_LABELS.other, text: 'Ideas, feedback, press or partnership.', icon: MessageSquareText },
];

const TEAM_TOPICS = new Set<string>(['adoption', 'problem', 'account', 'privacy', 'other']);
const isTeamTopic = (choice: Choice | null): choice is ContactTopic => choice !== null && TEAM_TOPICS.has(choice);

const PLACEHOLDERS: Record<ContactTopic, string> = {
  adoption: 'Which department or faculty, which levels, and when you’d like to start.',
  problem: 'What you did, what you expected, and what happened instead.',
  account: 'What you tried, what the screen said, and who you have already asked.',
  privacy: 'What you would like us to do. We may ask you to confirm it is you.',
  other: 'How can we help?',
};

const ROLE_OPTIONS = CONTACT_ROLES.map((value) => ({ value, label: CONTACT_ROLE_LABELS[value] }));
const PRIVACY_OPTIONS = CONTACT_PRIVACY_REQUESTS.map((value) => ({ value, label: CONTACT_PRIVACY_REQUEST_LABELS[value] }));
const TOPIC_OPTIONS = (['adoption', 'problem', 'account', 'privacy', 'other'] as const).map((value) => ({ value, label: CONTACT_TOPIC_LABELS[value] }));

/** "Chrome 131 · Android 14 · 412×915": enough to reproduce a problem, nothing that identifies a person. */
function describeDevice(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\/(\d+)/.exec(ua)?.[1] ? `Edge ${/Edg\/(\d+)/.exec(ua)?.[1]}`
    : /OPR\/(\d+)/.exec(ua) ? `Opera ${/OPR\/(\d+)/.exec(ua)?.[1]}`
      : /SamsungBrowser\/(\d+)/.exec(ua) ? `Samsung Internet ${/SamsungBrowser\/(\d+)/.exec(ua)?.[1]}`
        : /Firefox\/(\d+)/.exec(ua) ? `Firefox ${/Firefox\/(\d+)/.exec(ua)?.[1]}`
          : /Chrome\/(\d+)/.exec(ua) ? `Chrome ${/Chrome\/(\d+)/.exec(ua)?.[1]}`
            : /Version\/(\d+).*Safari/.exec(ua) ? `Safari ${/Version\/(\d+)/.exec(ua)?.[1]}`
              : 'Browser';
  const system = /Android (\d+)/.exec(ua) ? `Android ${/Android (\d+)/.exec(ua)?.[1]}`
    : /(iPhone|iPad).*OS (\d+)/.exec(ua) ? `iOS ${/OS (\d+)/.exec(ua)?.[1]}`
      : /Windows NT/.test(ua) ? 'Windows'
        : /Mac OS X/.test(ua) ? 'macOS'
          : /CrOS/.test(ua) ? 'ChromeOS'
            : /Linux/.test(ua) ? 'Linux' : 'Unknown system';
  const installed = window.matchMedia('(display-mode: standalone)').matches ? ' · installed app' : '';
  return `${browser} · ${system} · ${window.screen.width}×${window.screen.height}${installed}`;
}

function roleFor(accountType: string | undefined): ContactRole | '' {
  if (accountType === 'student') return 'student';
  if (accountType === 'lecturer') return 'lecturer';
  if (accountType === 'administrator') return 'administrator';
  return '';
}

/** Scrolls a freshly revealed panel into view, unless most of it is already showing. */
function reveal(element: HTMLElement | null) {
  if (!element) return;
  const rect = element.getBoundingClientRect();
  if (rect.top > 80 && rect.top < window.innerHeight * 0.55) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

/** Links can open the page on a topic: /contact?topic=privacy. */
export function ContactRouterFromLink() {
  const topic = useSearchParams().get('topic');
  const initial = topic && (TEAM_TOPICS.has(topic) || LOCAL.some((item) => item.id === topic)) ? (topic as Choice) : null;
  return <ContactRouter initialTopic={initial} />;
}

export function ContactRouter({ initialTopic = null }: Readonly<{ initialTopic?: Choice | null }>) {
  const [choice, setChoice] = useState<Choice | null>(initialTopic);
  const [sent, setSent] = useState<{ reference: string; email: string; topic: ContactTopic } | null>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  const groupName = useId();

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      if (!initialTopic) return;
    }
    if (choice === null) return;
    // Wait a frame so the panel exists and has its height.
    const frame = requestAnimationFrame(() => reveal(isTeamTopic(choice) ? formRef.current : answerRef.current));
    return () => cancelAnimationFrame(frame);
  }, [choice, initialTopic]);

  const local = LOCAL.find((item) => item.id === choice) ?? null;

  const card = (id: Choice, title: string, text: ReactNode, Icon: typeof ScanFace, kind: 'local' | 'team') => (
    <label className={`ct-choice is-${kind}${choice === id ? ' is-on' : ''}`} data-cursor="lock" key={id}>
      <input
        className="ct-choice-input"
        type="radio"
        name={groupName}
        value={id}
        checked={choice === id}
        onChange={() => { setChoice(id); setSent(null); }}
      />
      <span className="ct-choice-icon" aria-hidden="true"><Icon size={19} /></span>
      <span className="ct-choice-copy">
        <strong>{title}</strong>
        <span>{text}</span>
      </span>
      <span className="ct-choice-mark" aria-hidden="true"><Check size={13} strokeWidth={3} /></span>
    </label>
  );

  return (
    <div className="ct-router">
      <fieldset className="ct-step">
        <legend className="ct-step-head">
          <span className="ct-step-n" aria-hidden="true">1</span>
          <span>What’s it about?</span>
        </legend>

        <div className="ct-groups">
          <section className="ct-group" aria-labelledby="ct-local-title">
            <header className="ct-group-head">
              <h2 id="ct-local-title">Fixed fastest in your department</h2>
              <p>The people who run your classes can solve these today.</p>
            </header>
            <div className="ct-choices">
              {LOCAL.map((item) => card(item.id, item.title, item.who, item.icon, 'local'))}
            </div>
          </section>

          <section className="ct-group" aria-labelledby="ct-team-title">
            <header className="ct-group-head">
              <h2 id="ct-team-title">For the LASUATOS team</h2>
              <p>Write to us. Every message gets a reference and a reply.</p>
            </header>
            <div className="ct-choices">
              {TEAM.map((item) => card(item.id, item.title, item.text, item.icon, 'team'))}
            </div>
          </section>
        </div>
      </fieldset>

      {local ? (
        <div className="ct-answer" ref={answerRef} key={local.id} role="region" aria-labelledby="ct-answer-title">
          <div className="ct-answer-main">
            <p className="ct-answer-kicker"><span className="ct-step-n" aria-hidden="true">2</span> Who can fix it</p>
            <h2 id="ct-answer-title">{local.who}</h2>
            <p className="ct-answer-why">{local.why}</p>
            <Link className="ct-answer-help" href={local.help.href}><LifeBuoy size={16} aria-hidden="true" /> {local.help.label}</Link>
          </div>
          <div className="ct-answer-side">
            <h3>Tell them</h3>
            <ul>
              {local.bring.map((item) => <li key={item}><Check size={15} strokeWidth={2.6} aria-hidden="true" />{item}</li>)}
            </ul>
            <button className="ct-escalate" type="button" onClick={() => setChoice('account')}>
              Already asked and still stuck? <span>Write to the LASUATOS team <ArrowRight size={15} aria-hidden="true" /></span>
            </button>
          </div>
        </div>
      ) : null}

      {isTeamTopic(choice) ? (
        <div className="ct-write" ref={formRef}>
          {sent ? (
            <ContactSent sent={sent} onAnother={() => setSent(null)} />
          ) : (
            <ContactForm topic={choice} onTopicChange={setChoice} onSent={setSent} />
          )}
        </div>
      ) : null}
    </div>
  );
}

function ContactForm({ topic, onTopicChange, onSent }: Readonly<{
  topic: ContactTopic;
  onTopicChange: (topic: ContactTopic) => void;
  onSent: (sent: { reference: string; email: string; topic: ContactTopic }) => void;
}>) {
  const account = useCurrentAccount();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ContactRole | ''>('');
  const [department, setDepartment] = useState('');
  const [matric, setMatric] = useState('');
  const [privacyRequest, setPrivacyRequest] = useState<ContactPrivacyRequest | ''>('');
  const [page, setPage] = useState('');
  const [students, setStudents] = useState('');
  const [message, setMessage] = useState('');
  const [includeDevice, setIncludeDevice] = useState(true);
  const [device, setDevice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const startedAt = useRef(0);
  const prefilled = useRef(false);
  const honeypotId = useId();

  useEffect(() => {
    startedAt.current = performance.now();
  }, []);

  // Signed in: fill in what we already know, once (never over what they typed).
  useEffect(() => {
    if (!account || prefilled.current) return;
    prefilled.current = true;
    const known = account;
    queueMicrotask(() => {
      setName((value) => value || known.displayName);
      setEmail((value) => value || known.email);
      setRole((value) => value || roleFor(known.accountType));
      if (known.accountType === 'student') setMatric((value) => value || known.matricNumber);
    });
  }, [account]);

  useEffect(() => {
    if (topic !== 'problem') return;
    queueMicrotask(() => setDevice(describeDevice()));
  }, [topic]);

  const isStudent = role === 'student' || role === 'class_rep';
  const wantsMatric = isStudent && (topic === 'privacy' || topic === 'account' || topic === 'problem');
  const length = message.trim().length;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const form = event.currentTarget;
    const website = (form.elements.namedItem('website') as HTMLInputElement | null)?.value ?? '';
    try {
      const result = await sendContactMessage({
        topic,
        name: name.trim(),
        email: email.trim(),
        ...(role ? { role } : {}),
        ...(department.trim() ? { department: department.trim() } : {}),
        ...(wantsMatric && matric.trim() ? { matricNumber: matric.trim() } : {}),
        ...(topic === 'privacy' && privacyRequest ? { privacyRequest } : {}),
        ...(topic === 'problem' && page.trim() ? { page: page.trim() } : {}),
        ...(topic === 'problem' && includeDevice && device ? { device } : {}),
        ...(topic === 'adoption' && students ? { students: Number(students) } : {}),
        message: message.trim(),
        ...(website ? { website } : {}),
        elapsedMs: Math.round(performance.now() - startedAt.current),
      });
      onSent({ reference: result.reference, email: email.trim().toLowerCase(), topic });
    } catch (caught) {
      setError(failureText(caught, 'Your message was not sent. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ct-write-grid">
      <form className="ct-form" onSubmit={(event) => void submit(event)} aria-labelledby="ct-form-title">
        <p className="ct-answer-kicker"><span className="ct-step-n" aria-hidden="true">2</span> Write to us</p>
        <h2 id="ct-form-title" className="ct-form-title">Your message</h2>

        <label className="ct-field ct-span">
          <span>Topic</span>
          <Select value={topic} onValueChange={(value) => onTopicChange(value as ContactTopic)} options={TOPIC_OPTIONS} searchable={false} />
        </label>

        <label className="ct-field">
          <span>Your name</span>
          <input name="name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required minLength={2} maxLength={120}
            pattern="[\p{L}\p{M}][\p{L}\p{M} .'’\-]*" data-pattern-message="Use letters for your name." />
        </label>
        <label className="ct-field">
          <span>Email for our reply</span>
          <input name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" required maxLength={254} placeholder="you@example.com" />
        </label>

        <label className="ct-field">
          <span>You are</span>
          <Select value={role} onValueChange={(value) => setRole(value as ContactRole)} options={ROLE_OPTIONS} placeholder="Choose one" required searchable={false} />
        </label>
        <label className="ct-field">
          <span>{topic === 'adoption' ? 'Department or faculty' : 'Department or unit'} {topic === 'adoption' ? null : <em>optional</em>}</span>
          <input name="department" value={department} onChange={(event) => setDepartment(event.target.value)} maxLength={160} required={topic === 'adoption'} placeholder="e.g. Computer Engineering" autoComplete="organization" />
        </label>

        {topic === 'privacy' ? (
          <label className="ct-field">
            <span>Your request</span>
            <Select value={privacyRequest} onValueChange={(value) => setPrivacyRequest(value as ContactPrivacyRequest)} options={PRIVACY_OPTIONS} placeholder="Choose one" required searchable={false} />
          </label>
        ) : null}
        {wantsMatric ? (
          <label className="ct-field">
            <span>Matric number <em>optional</em></span>
            <input name="matric" value={matric} onChange={(event) => setMatric(event.target.value)} inputMode="numeric" autoComplete="off" maxLength={20}
              pattern="[0-9 ]{6,14}" data-pattern-message="A matric number has digits only." placeholder="e.g. 220591001" />
          </label>
        ) : null}
        {topic === 'adoption' ? (
          <label className="ct-field">
            <span>Students, roughly <em>optional</em></span>
            <NumberField name="students" value={students} onChange={(event) => setStudents(event.target.value)} min={1} max={100000} nudge={50} placeholder="e.g. 400" />
          </label>
        ) : null}
        {topic === 'problem' ? (
          <label className="ct-field">
            <span>Where did it happen? <em>optional</em></span>
            <input name="page" value={page} onChange={(event) => setPage(event.target.value)} maxLength={200} placeholder="e.g. scanning the QR code in class" />
          </label>
        ) : null}

        <label className="ct-field ct-span">
          <span>Message</span>
          <textarea name="message" value={message} onChange={(event) => setMessage(event.target.value)} required minLength={CONTACT_MESSAGE_MIN} maxLength={CONTACT_MESSAGE_MAX}
            rows={6} placeholder={PLACEHOLDERS[topic]} />
          <small className={`ct-count${length > 0 && length < CONTACT_MESSAGE_MIN ? ' is-short' : ''}`} aria-live="polite">
            {length > 0 && length < CONTACT_MESSAGE_MIN ? `${CONTACT_MESSAGE_MIN - length} more characters, please` : `${length.toLocaleString('en-NG')} / ${CONTACT_MESSAGE_MAX.toLocaleString('en-NG')}`}
          </small>
        </label>

        {topic === 'problem' && device ? (
          <div className="ct-span">
            <SwitchField checked={includeDevice} onCheckedChange={setIncludeDevice} label="Include my browser and device" hint={device} />
          </div>
        ) : null}

        {/* Spam trap: hidden from people and screen readers; bots fill in every field. */}
        <div className="ct-trap" aria-hidden="true">
          <label htmlFor={honeypotId}>Leave this empty</label>
          <input id={honeypotId} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
        </div>

        {error ? <p className="ct-error ct-span" role="alert">{error}</p> : null}

        <div className="ct-submit ct-span">
          <button className="ct-send" type="submit" disabled={busy} aria-busy={busy}>
            {busy ? <span className="ct-send-spin" aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
            {busy ? 'Sending…' : 'Send message'}
          </button>
          <p className="ct-fine">
            We use these details only to reply, and delete the message a year after it is handled. <Link href="/privacy">Privacy notice</Link>
          </p>
        </div>
      </form>

      <Slip topic={topic} name={name} email={email} role={role} />
    </div>
  );
}

/** A live routing slip: what will be sent, to whom, and what happens next. */
function Slip({ topic, name, email, role }: Readonly<{ topic: ContactTopic; name: string; email: string; role: ContactRole | '' }>) {
  return (
    <aside className="ct-slip" aria-label="What happens next">
      <div className="ct-slip-paper">
        <p className="ct-slip-head">Message slip</p>
        <dl>
          <div><dt>To</dt><dd>LASUATOS team</dd></div>
          <div><dt>Topic</dt><dd>{CONTACT_TOPIC_LABELS[topic]}</dd></div>
          <div><dt>From</dt><dd className={name.trim() ? '' : 'is-empty'}>{name.trim() || 'Your name'}{role ? <small>{CONTACT_ROLE_LABELS[role]}</small> : null}</dd></div>
          <div><dt>Reply to</dt><dd className={email.trim() ? '' : 'is-empty'}>{email.trim() || 'Your email'}</dd></div>
          <div><dt>Reference</dt><dd className="is-empty">Given when you send</dd></div>
        </dl>
        <ol className="ct-slip-steps">
          <li><span><Check size={12} strokeWidth={3} /></span>A receipt with your reference, by email</li>
          <li><span><UserRound size={12} strokeWidth={2.6} /></span>Read by the LASUATOS administrators</li>
          <li><span><KeyRound size={12} strokeWidth={2.6} /></span>A reply within two working days</li>
        </ol>
      </div>
    </aside>
  );
}

function ContactSent({ sent, onAnother }: Readonly<{ sent: { reference: string; email: string; topic: ContactTopic }; onAnother: () => void }>) {
  const [copied, setCopied] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    // The panel is much shorter than the form it replaces, so bring it into view before focusing it.
    sectionRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sent.reference);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="ct-sent" ref={sectionRef} aria-labelledby="ct-sent-title">
      <span className="ct-sent-mark" aria-hidden="true">
        <svg viewBox="0 0 52 52" width="52" height="52"><circle cx="26" cy="26" r="24" /><path d="M15 27l7 7 15-16" /></svg>
      </span>
      <h2 id="ct-sent-title" ref={headingRef} tabIndex={-1}>Message sent</h2>
      <p>
        We have emailed a receipt to <strong>{sent.email}</strong>. We usually reply within two working days.
        If it doesn’t arrive, check your spam folder.
      </p>
      <div className="ct-ref">
        <span>Your reference</span>
        <strong>{sent.reference}</strong>
        <button type="button" onClick={() => void copy()} aria-label={`Copy reference ${sent.reference}`}>
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="sr-only" role="status">{copied ? 'Reference copied' : ''}</p>
      <div className="ct-sent-actions">
        <Link className="pg-btn pg-btn-primary" href="/">Back to home</Link>
        <button className="pg-btn ct-btn-quiet" type="button" onClick={onAnother}>Write another message</button>
      </div>
    </section>
  );
}
