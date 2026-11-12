import type { Metadata } from 'next';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpenCheck,
  CalendarCheck,
  Check,
  GraduationCap,
  KeyRound,
  Landmark,
  ShieldCheck,
  UserRoundCog,
  UsersRound,
} from 'lucide-react';
import Link from 'next/link';
import { BrandMark } from '../components/brand-mark';

export const metadata: Metadata = {
  title: 'Courses and attendance for Lagos State University',
  description:
    'LASUATOS brings course setup, student enrollment and timed attendance check-ins into one role-based workspace for Lagos State University.',
};

const steps = [
  {
    number: '01',
    title: 'Lecturers set up courses',
    description: 'Create course offerings for an assigned department and semester.',
    icon: BookOpenCheck,
  },
  {
    number: '02',
    title: 'Students join with a code',
    description: 'Enter a code from your lecturer to add a course to My courses.',
    icon: KeyRound,
  },
  {
    number: '03',
    title: 'Lecturers open attendance',
    description: 'Run timed, course-scoped check-ins and review the live student roster.',
    icon: CalendarCheck,
  },
] as const;

const roleCards = [
  {
    id: 'student',
    label: 'FOR STUDENTS',
    title: 'Your courses, together.',
    description: 'Create your account, join a course with your lecturer’s code, check in to an open class session, and review your attendance history.',
    action: 'Create a student account',
    href: '/sign-up',
    icon: GraduationCap,
    tone: 'student',
  },
  {
    id: 'lecturer',
    label: 'FOR LECTURERS',
    title: 'Course tools that stay in scope.',
    description: 'Accept the staff invitation from your administrator, then create course offerings, manage enrollment, and run timed attendance sessions for assigned courses.',
    action: 'Sign in as a lecturer',
    href: '/sign-in',
    icon: UsersRound,
    tone: 'lecturer',
  },
  {
    id: 'administrator',
    label: 'FOR ADMINISTRATORS',
    title: 'A clear view of your area.',
    description: 'Sign in with your LASU-assigned administrator account to view activity within your institution, faculty, or department scope.',
    action: 'Open administration',
    href: '/sign-in',
    icon: UserRoundCog,
    tone: 'administrator',
  },
] as const;

export default function HomePage() {
  return (
    <div className="landing-page">
      <section className="landing-hero" aria-labelledby="hero-heading">
        <div className="landing-hero-copy">
          <p className="landing-eyebrow"><span /> LAGOS STATE UNIVERSITY <i /> FACULTY OF ENGINEERING FIRST</p>
          <h1 id="hero-heading">Course coordination and attendance, <em>made clear.</em></h1>
          <p className="landing-lede">
            A shared academic workspace for LASU. Lecturers organize offerings and open timed
            attendance sessions; students enroll and check in with a session code. Administrators
            see activity within their assigned scope.
          </p>
          <div className="landing-actions">
            <Link className="button button-primary landing-primary-action" href="/sign-up">
              Create a student account <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link className="landing-secondary-action" href="/sign-in">
              Sign in to your workspace <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <div className="landing-trust-row" aria-label="LASUATOS focus">
            <span><Landmark size={16} aria-hidden="true" /> Lagos State University</span>
            <i aria-hidden="true" />
            <span>Built around LASU’s academic structure</span>
          </div>
        </div>

        <div className="landing-visual" aria-label="How courses and attendance work">
          <div className="visual-orbit visual-orbit-one" />
          <div className="visual-orbit visual-orbit-two" />
          <div className="visual-grid" />
          <div className="visual-university-mark"><BrandMark className="visual-brand-mark" /></div>
          <div className="visual-caption">
            <span className="visual-caption-rule" />
            <span>ONE UNIVERSITY, ONE SHARED FLOW</span>
          </div>
          <div className="course-flow-card">
            <div className="course-flow-heading">
              <div>
                <p className="course-flow-kicker">COURSES &amp; ATTENDANCE</p>
                <h2>From course setup to class check-in.</h2>
              </div>
              <span className="course-flow-badge"><Check size={15} aria-hidden="true" /></span>
            </div>
            <div className="course-flow-step">
              <span className="course-flow-number">01</span>
              <div><strong>Lecturer creates an offering</strong><small>Within their assigned department</small></div>
              <BookOpenCheck size={17} aria-hidden="true" />
            </div>
            <div className="course-flow-connector" />
            <div className="course-flow-step">
              <span className="course-flow-number">02</span>
              <div><strong>Students enroll in a course</strong><small>Using a lecturer-issued course code</small></div>
              <KeyRound size={17} aria-hidden="true" />
            </div>
            <div className="course-flow-connector" />
            <div className="course-flow-step">
              <span className="course-flow-number">03</span>
              <div><strong>Students check in to class</strong><small>Using a time-limited session code</small></div>
              <CalendarCheck size={17} aria-hidden="true" />
            </div>
            <div className="course-flow-foot"><span /> Session code records use and time, not venue presence</div>
          </div>
          <div className="visual-side-note"><span>LASU</span><small>LEARN · TEACH · CONNECT</small></div>
        </div>
      </section>

      <section className="landing-steps-section" id="how-it-works" aria-labelledby="how-heading">
        <div className="landing-section-heading">
          <div>
            <p className="landing-section-kicker">COURSE SETUP TO ATTENDANCE</p>
            <h2 id="how-heading">The right tools for every role.</h2>
          </div>
          <p>One LASU workspace with role-based paths from course setup through session-code attendance.</p>
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
            <p className="landing-section-kicker">CHOOSE YOUR PATH</p>
            <h2 id="roles-heading">Start where you belong.</h2>
          </div>
          <p>Access is assigned by role. Student sign-up cannot grant lecturer or administrator access.</p>
        </div>
        <div className="landing-role-grid">
          {roleCards.map(({ id, label, title, description, action, href, icon: Icon, tone }) => (
            <article className={`landing-role-card role-${tone}`} id={id} key={id}>
              <div className="role-card-icon"><Icon size={21} strokeWidth={1.8} aria-hidden="true" /></div>
              <p className="landing-role-label">{label}</p>
              <h3>{title}</h3>
              <p className="landing-role-description">{description}</p>
              <Link className="landing-role-link" href={href}>
                {action} <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </article>
          ))}
        </div>
        <p className="role-access-note">
          <ShieldCheck size={16} aria-hidden="true" /> Lecturers and administrators join by email invitation from an administrator; access is checked against your account on the server.
        </p>
      </section>

      <section className="landing-lasu-panel" id="lasu" aria-labelledby="lasu-heading">
        <div className="lasu-panel-mark"><Landmark size={23} strokeWidth={1.7} aria-hidden="true" /></div>
        <div className="lasu-panel-copy">
          <p className="landing-section-kicker">MADE FOR LASU</p>
          <h2 id="lasu-heading">Starting with the Faculty of Engineering.</h2>
          <p>
            LASUATOS is focused on Lagos State University, with the Faculty of Engineering as its
            first academic home. Departments and academic scopes keep the structure ready to grow
            with the University.
          </p>
        </div>
        <Link className="lasu-panel-link" href="/sign-in">
          Enter LASUATOS <ArrowUpRight size={17} aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}
