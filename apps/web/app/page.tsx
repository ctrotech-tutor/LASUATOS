import type { Metadata } from 'next';
import {
  ArrowRight,
  ArrowUpRight,
  ClipboardList,
  Landmark,
  MonitorPlay,
  Printer,
  QrCode,
  ScanLine,
  ShieldCheck,
  Timer,
  UserRoundCog,
  UsersRound,
} from 'lucide-react';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Attendance in seconds for Lagos State University',
  description:
    'Lecturers and class reps open attendance with a course code and title; students scan a QR code or type a code to mark attendance, with or without an account.',
};

const entries = [
  {
    href: '/a',
    tone: 'student',
    icon: ScanLine,
    label: 'Students',
    title: 'Mark my attendance',
    description: 'Scan the QR code or type the code. No account needed.',
  },
  {
    href: '/sessions',
    tone: 'lecturer',
    icon: QrCode,
    label: 'Lecturers & class reps',
    title: 'Take attendance',
    description: 'Course code, title, time. Get a QR code in seconds.',
  },
  {
    href: '/admin',
    tone: 'administrator',
    icon: UserRoundCog,
    label: 'Administrators',
    title: 'Open administration',
    description: 'Staff, class reps, venues and attendance reports.',
  },
] as const;

const steps = [
  {
    number: '01',
    title: 'Start a session',
    description: 'Type the course code and title. Today’s date is filled in; choose how long attendance stays open.',
    icon: Timer,
  },
  {
    number: '02',
    title: 'Show or print the QR code',
    description: 'Put a changing QR code on the projector, or download a poster to print and paste at the door.',
    icon: QrCode,
  },
  {
    number: '03',
    title: 'Students scan and go',
    description: 'They scan with their phone camera and confirm their name and matric number. The list fills in live.',
    icon: ClipboardList,
  },
] as const;

export default function HomePage() {
  return (
    <div className="landing-page">
      <section className="landing-hero lp-hero" aria-labelledby="hero-heading">
        <div className="landing-hero-copy">
          <p className="landing-eyebrow"><span /> LAGOS STATE UNIVERSITY <i /> FACULTY OF ENGINEERING</p>
          <h1 id="hero-heading">Attendance in seconds, <em>not minutes.</em></h1>
          <p className="landing-lede">
            No more passing a sheet round the hall. Open a session from your phone, show or print the QR code,
            and every student marks attendance with a quick scan.
          </p>
          <div className="landing-trust-row" aria-label="LASUATOS focus">
            <span><Landmark size={16} aria-hidden="true" /> Built for LASU</span>
            <i aria-hidden="true" />
            <span>Works on any phone with a camera</span>
          </div>
        </div>

        <nav className="lp-entries" aria-label="Choose what you want to do">
          <p className="lp-entries-title">What do you want to do?</p>
          {entries.map(({ href, tone, icon: Icon, label, title, description }) => (
            <Link className={`lp-entry is-${tone}`} href={href} key={href}>
              <span className="lp-entry-icon"><Icon size={26} strokeWidth={1.9} aria-hidden="true" /></span>
              <span className="lp-entry-copy">
                <small>{label}</small>
                <strong>{title}</strong>
                <span>{description}</span>
              </span>
              <ArrowRight className="lp-entry-arrow" size={20} aria-hidden="true" />
            </Link>
          ))}
        </nav>
      </section>

      <section className="landing-steps-section" id="how-it-works" aria-labelledby="how-heading">
        <div className="landing-section-heading">
          <div>
            <p className="landing-section-kicker">HOW IT WORKS</p>
            <h2 id="how-heading">Three steps. About a minute.</h2>
          </div>
          <p>Lecturers, HOCs and GHOCs use the same simple flow. Students don’t need to install anything.</p>
        </div>
        <div className="landing-steps-grid">
          {steps.map(({ number, title, description, icon: Icon }) => (
            <article className="landing-step-card" key={number}>
              <div className="landing-step-topline"><span>{number}</span><Icon size={19} strokeWidth={1.8} aria-hidden="true" /></div>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-roles-section" id="roles" aria-labelledby="roles-heading">
        <div className="landing-section-heading landing-roles-heading">
          <div>
            <p className="landing-section-kicker">TWO KINDS OF QR CODE</p>
            <h2 id="roles-heading">Projector or no projector.</h2>
          </div>
          <p>Pick one when you start; switch any time during the session.</p>
        </div>
        <div className="landing-role-grid lp-mode-grid">
          <article className="landing-role-card role-lecturer">
            <div className="role-card-icon"><MonitorPlay size={21} strokeWidth={1.8} aria-hidden="true" /></div>
            <p className="landing-role-label">ON A SCREEN</p>
            <h3>A QR code that keeps changing.</h3>
            <p className="landing-role-description">It changes every 30 seconds, so a photo forwarded to a group chat soon stops working. Show it full screen on a projector, TV or your own phone.</p>
          </article>
          <article className="landing-role-card role-student">
            <div className="role-card-icon"><Printer size={21} strokeWidth={1.8} aria-hidden="true" /></div>
            <p className="landing-role-label">PRINTED POSTER</p>
            <h3>Download, print, paste.</h3>
            <p className="landing-role-description">One fixed QR code with the course name and a short code, ready to print on A4 and stick by the door. It works until the session closes.</p>
          </article>
          <article className="landing-role-card role-administrator">
            <div className="role-card-icon"><UsersRound size={21} strokeWidth={1.8} aria-hidden="true" /></div>
            <p className="landing-role-label">HOCS AND GHOCS</p>
            <h3>Class reps can run it too.</h3>
            <p className="landing-role-description">Each department’s HOC can take attendance. The faculty GHOC for each set can add HOCs; administrators appoint GHOCs.</p>
          </article>
        </div>
        <p className="role-access-note">
          <ShieldCheck size={16} aria-hidden="true" /> Students without an account type their name and matric number. Lecturers see who used the same phone and can remove entries.
        </p>
      </section>

      <section className="landing-lasu-panel" id="lasu" aria-labelledby="lasu-heading">
        <div className="lasu-panel-mark"><Landmark size={23} strokeWidth={1.7} aria-hidden="true" /></div>
        <div className="lasu-panel-copy">
          <p className="landing-section-kicker">STUDENTS</p>
          <h2 id="lasu-heading">Want your details filled in for you?</h2>
          <p>Create a free student account once. Every scan after that marks you present in one tap, and you can see all your attendance in one place.</p>
        </div>
        <Link className="lasu-panel-link" href="/sign-up">
          Create a student account <ArrowUpRight size={17} aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}
