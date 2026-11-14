import type { Metadata } from 'next';
import {
  ArrowRight,
  Check,
  KeyRound,
  MapPinned,
  MonitorPlay,
  Plus,
  Printer,
  QrCode,
  ScanFace,
  Smartphone,
  TimerReset,
} from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import '@fontsource/caveat/500.css';
import { InstallAppButton } from '../components/install-app';
import { HeroDemo } from '../components/home/hero-demo';
import { MockQr } from '../components/home/mock-qr';
import { RevealOnScroll } from '../components/home/reveal';
import { RoleTabs } from '../components/home/role-tabs';
import { Tight } from '../components/tight';
import './home.css';

export const metadata: Metadata = {
  title: { absolute: 'LASUATOS | Lecture attendance in seconds for Lagos State University' },
  description:
    'Lecturers put up a QR code; students scan it with their own phone and a face check. Every check-in is confirmed inside the hall, and the register fills itself in.',
};

const SHEET = [
  { name: 'Adeyemi T.', matric: '220591118', sign: 'T.Ade' },
  { name: 'Bello A', matric: '22059100?', sign: 'Bello', flag: 'smudge' },
  { name: 'Okafor C.', matric: '220591034', sign: 'Chi' },
  { name: 'Okafor C.', matric: '220591034', sign: 'Chi', flag: 'twice' },
  { name: 'Seun (for Tunde)', matric: '—', sign: 'S', flag: 'friend' },
  { name: 'Eze', matric: '2205910', sign: '~', flag: 'short' },
] as const;

const CHECKS = [
  {
    icon: KeyRound,
    title: 'Their own account',
    text: 'Opened from the class list with their matric number and a code sent to their LASU student email.',
    tag: 'LASU email',
  },
  {
    icon: ScanFace,
    title: 'Their own face',
    text: 'Matched to the face registered on the account, with a liveness check, so a photo of a photo won’t pass.',
    tag: 'Face + liveness',
  },
  {
    icon: MapPinned,
    title: 'Inside the hall',
    text: 'The phone’s location has to fall inside the venue, and the accuracy is shown: ± 9 m, not “somewhere on campus”.',
    tag: 'Location',
  },
  {
    icon: TimerReset,
    title: 'A fresh code',
    text: 'The projector QR changes every 30 seconds. A photo forwarded to the group chat stops working almost at once.',
    tag: '30-second QR',
  },
] as const;

const FAQ = [
  {
    q: 'Do students need to download an app?',
    a: 'No. The phone camera opens LASUATOS in the browser straight from the QR code. Students who use it every day can add it to their home screen in two taps.',
  },
  {
    q: 'What if a student has no phone, or a flat battery?',
    a: 'They sign in on a classmate’s phone just for that check-in, with their own account and face. The lecturer sees every entry made from the same phone, so nothing is hidden.',
  },
  {
    q: 'Can someone mark attendance for a friend?',
    a: 'That is exactly what LASUATOS is built to stop. A check-in needs the student’s own account, their face with a liveness check, a phone inside the venue and a code that changes every 30 seconds.',
  },
  {
    q: 'My face check keeps failing. What now?',
    a: 'After two tries, ask for help from the check-in screen. The person taking attendance sees your registered photo, looks up, and adds you if it’s you. Nobody is locked out of a lecture by a bad camera.',
  },
  {
    q: 'My matric number is not found.',
    a: 'Your class list comes from your HOC. Ask them to add you (it takes a few seconds) and you can open your account straight away.',
  },
  {
    q: 'What happens to my face data?',
    a: 'It is used only to confirm that it is you checking in. It is never shown to classmates, check-in photos are deleted after 90 days, and your registered face is deleted after your set graduates.',
  },
  {
    q: 'Who can take attendance?',
    a: 'Lecturers, and the HOC or GHOC of a class when the lecturer asks them to. Class reps cannot remove a classmate’s check-in; lecturers and administrators review those.',
  },
] as const;

export default function HomePage() {
  return (
    <div className="hp">
      <RevealOnScroll />

      {/* ───────────── Hero ───────────── */}
      <section className="hp-hero" aria-labelledby="hp-title">
        <div className="hp-hero-grid hp-wrap">
          <div className="hp-hero-copy">
            <h1 id="hp-title" className="hp-title">
              <Tight>Attendance in seconds.</Tight>
              <span className="hp-title-accent"> <Tight>And it can’t be faked.</Tight></span>
            </h1>
            <p className="hp-lede">
              The lecturer puts up a QR code. Students scan it with their own phone, look at the camera, and they are on
              the register, confirmed inside the hall. No sheet going round. No signing for a friend.
            </p>
            <div className="hp-cta-row">
              <Link className="hp-btn hp-btn-primary" href="/a">
                <QrCode size={18} aria-hidden="true" /> Mark my attendance
              </Link>
              <Link className="hp-btn hp-btn-ghost" href="/sessions">
                Take attendance <ArrowRight size={17} aria-hidden="true" />
              </Link>
            </div>
            <p className="hp-hero-note">
              New here? <Link href="/sign-up">Open your student account</Link> with your matric number.
            </p>
          </div>
          <div className="hp-hero-visual">
            <HeroDemo />
            <p className="sr-only">
              Illustration: a projector shows a changing QR code for MEE 301; a student’s phone scans it, checks their face and
              location, and shows “You’re marked present”, while the live register counts students as they arrive.
            </p>
          </div>
        </div>
      </section>

      {/* ───────────── The old way ───────────── */}
      <section className="hp-section hp-old" aria-labelledby="hp-old-title">
        <div className="hp-wrap hp-old-grid">
          <div className="hp-sheet-wrap" data-reveal aria-hidden="true">
            <div className="hp-sheet">
              <div className="hp-sheet-head">
                <b>MEE 301 — ATTENDANCE</b>
                <span>Date: ____/____/______</span>
              </div>
              <div className="hp-sheet-cols"><span>S/N</span><span>Name</span><span>Matric No.</span><span>Sign</span></div>
              {SHEET.map((row, index) => (
                <div className={`hp-sheet-row${'flag' in row ? ` is-${row.flag}` : ''}`} key={`${row.name}-${index}`}>
                  <span>{index + 1}.</span>
                  <span className="hp-hand">{row.name}</span>
                  <span className="hp-hand">{row.matric}</span>
                  <span className="hp-hand">{row.sign}</span>
                </div>
              ))}
              <div className="hp-sheet-row is-empty"><span>7.</span><span /><span /><span /></div>
              <span className="hp-note hp-note-twice">Signed twice</span>
              <span className="hp-note hp-note-friend">“for Tunde”</span>
              <span className="hp-note hp-note-smudge">Can’t read it</span>
              <span className="hp-sheet-page">Page 3 of ?</span>
            </div>
          </div>
          <div className="hp-old-copy">
            <p className="hp-kicker">The problem</p>
            <h2 id="hp-old-title" className="hp-h2"><Tight>A sheet of paper was never a register.</Tight></h2>
            <p className="hp-body">
              It goes round a 300-seat hall while the lecture waits. Friends sign for friends. Half the matric numbers are
              unreadable, and someone still has to type it all up before exams.
            </p>
            <ul className="hp-versus">
              <li><span className="hp-versus-old">Passed round for most of the lecture</span><span className="hp-versus-new">Everyone checks in at once, in seconds</span></li>
              <li><span className="hp-versus-old">Anyone can sign any name</span><span className="hp-versus-new">Own account, own face, inside the hall</span></li>
              <li><span className="hp-versus-old">Typed up by hand, weeks later</span><span className="hp-versus-new">Percentages ready, export to Excel</span></li>
            </ul>
          </div>
        </div>
      </section>

      {/* ───────────── How it works ───────────── */}
      <section className="hp-section hp-how" id="how" aria-labelledby="hp-how-title">
        <div className="hp-wrap">
          <div className="hp-head">
            <p className="hp-kicker">How it works</p>
            <h2 id="hp-how-title" className="hp-h2"><Tight>Three steps. One minute. Every lecture.</Tight></h2>
          </div>
          <ol className="hp-steps">
            <li className="hp-step" data-reveal>
              <div className="hp-step-art" aria-hidden="true">
                <div className="hp-mini-card">
                  <small>Course</small>
                  <b>MEE 301 · Engineering Thermodynamics</b>
                  <small>Open for</small>
                  <div className="hp-mini-seg"><span>10 min</span><span className="is-on">15 min</span><span>30 min</span></div>
                  <span className="hp-mini-btn">Start attendance</span>
                </div>
              </div>
              <span className="hp-step-no">01</span>
              <h3>Start a session</h3>
              <p>Pick the course from the list. Today’s date and your name are filled in; choose how long attendance stays open.</p>
            </li>
            <li className="hp-step" data-reveal>
              <div className="hp-step-art" aria-hidden="true">
                <div className="hp-mini-screen">
                  <MockQr seed={42} className="hp-mini-qr" />
                  <span>New code in 18s</span>
                </div>
              </div>
              <span className="hp-step-no">02</span>
              <h3>Put the code up</h3>
              <p>Show the changing QR code on the projector or your own phone, or print a poster for the door.</p>
            </li>
            <li className="hp-step" data-reveal>
              <div className="hp-step-art" aria-hidden="true">
                <div className="hp-mini-phone">
                  <span className="hp-mini-check"><Check size={18} strokeWidth={3} /></span>
                  <b>Marked present</b>
                  <small>Today, 08:02</small>
                </div>
              </div>
              <span className="hp-step-no">03</span>
              <h3>Students scan, look, done</h3>
              <p>Scan, a quick face check, and they’re in. You watch the register fill in live, and close it when you’re ready.</p>
            </li>
          </ol>
        </div>
      </section>

      {/* ───────────── Four checks ───────────── */}
      <section className="hp-checks" id="checks" aria-labelledby="hp-checks-title">
        <div className="hp-wrap">
          <div className="hp-head is-light">
            <p className="hp-kicker">Built against proxy attendance</p>
            <h2 id="hp-checks-title" className="hp-h2"><Tight>Every check-in passes four checks.</Tight></h2>
            <p className="hp-body">All four happen in the few seconds between the scan and “You’re marked present”. If one fails, the student is told exactly why, and what to do.</p>
          </div>
          <ol className="hp-check-track" data-reveal>
            {CHECKS.map(({ icon: Icon, title, text, tag }, index) => (
              <li key={title} className="hp-check" style={{ '--i': index } as CSSProperties}>
                <span className="hp-check-node"><Icon size={20} aria-hidden="true" /></span>
                <span className="hp-check-tag">{tag}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
            <li className="hp-check-result" aria-label="Result">
              <span><Check size={16} strokeWidth={3} aria-hidden="true" /> Present</span>
            </li>
          </ol>
          <p className="hp-checks-foot">
            <Smartphone size={15} aria-hidden="true" />
            Several students on one phone? Each entry is flagged for the lecturer, who can see it and decide.
          </p>
        </div>
      </section>

      {/* ───────────── Roles ───────────── */}
      <section className="hp-section hp-for" id="roles" aria-labelledby="hp-roles-title">
        <div className="hp-wrap">
          <div className="hp-head">
            <p className="hp-kicker">Who it’s for</p>
            <h2 id="hp-roles-title" className="hp-h2"><Tight>One platform for everyone in the lecture room.</Tight></h2>
          </div>
          <RoleTabs />
        </div>
      </section>

      {/* ───────────── QR modes ───────────── */}
      <section className="hp-section hp-modes" aria-labelledby="hp-modes-title">
        <div className="hp-wrap">
          <div className="hp-head hp-head-split">
            <div>
              <p className="hp-kicker">Two kinds of QR code</p>
              <h2 id="hp-modes-title" className="hp-h2"><Tight>Projector or no projector.</Tight></h2>
            </div>
            <p className="hp-body">Choose one when you start, and switch at any time during the session.</p>
          </div>
          <div className="hp-mode-grid">
            <article className="hp-mode" data-reveal>
              <div className="hp-mode-art is-screen" aria-hidden="true">
                <div className="hp-mode-screen">
                  <MockQr seed={7} className="hp-mode-qr" />
                  <span className="hp-mode-timer"><i /> 24s</span>
                </div>
              </div>
              <div className="hp-mode-copy">
                <p className="hp-mode-label"><MonitorPlay size={15} aria-hidden="true" /> On a screen</p>
                <h3>A QR code that keeps changing.</h3>
                <p>A new code every 30 seconds, full screen on a projector, TV or your own phone. Screenshots shared to a group chat expire almost at once.</p>
              </div>
            </article>
            <article className="hp-mode" data-reveal>
              <div className="hp-mode-art is-paper" aria-hidden="true">
                <div className="hp-mode-poster">
                  <b>MEE 301</b>
                  <small>Engineering Thermodynamics</small>
                  <MockQr seed={19} className="hp-mode-qr" />
                  <span>Code <b>K7QM</b></span>
                </div>
              </div>
              <div className="hp-mode-copy">
                <p className="hp-mode-label"><Printer size={15} aria-hidden="true" /> Printed poster</p>
                <h3>Download, print, paste.</h3>
                <p>One fixed code with the course name, ready for A4 and the door of the hall. The face and location checks still apply, and it stops working when you close the session.</p>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* ───────────── FAQ ───────────── */}
      <section className="hp-section hp-faq" id="faq" aria-labelledby="hp-faq-title">
        <div className="hp-wrap hp-faq-grid">
          <div className="hp-faq-intro">
            <p className="hp-kicker">Questions</p>
            <h2 id="hp-faq-title" className="hp-h2"><Tight>The things people ask first.</Tight></h2>
            <p className="hp-body">Something else? The <Link href="/help">help page</Link> covers every step, and <Link href="/privacy">what we record</Link> explains your data in plain words.</p>
          </div>
          <div className="hp-faq-list">
            {FAQ.map(({ q, a }) => (
              <details className="hp-qa" key={q} name="hp-faq">
                <summary>
                  <span>{q}</span>
                  <span className="hp-qa-icon" aria-hidden="true"><Plus size={18} /></span>
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────── Final call ───────────── */}
      <section className="hp-final" aria-labelledby="hp-final-title">
        <div className="hp-wrap">
          <div className="hp-final-card" data-reveal>
            <div className="hp-final-copy">
              <h2 id="hp-final-title"><Tight>Your next lecture can start with a full register.</Tight></h2>
              <p>Students: open your account once, it takes two minutes. Lecturers: your first session takes less.</p>
            </div>
            <div className="hp-final-actions">
              <Link className="hp-btn hp-btn-gold" href="/sign-up">Open my student account <ArrowRight size={17} aria-hidden="true" /></Link>
              <Link className="hp-btn hp-btn-onDark" href="/sessions">Take attendance</Link>
              <InstallAppButton className="hp-install" label="Install the app" />
            </div>
            <span className="hp-final-deco" aria-hidden="true" />
          </div>
        </div>
      </section>
    </div>
  );
}
