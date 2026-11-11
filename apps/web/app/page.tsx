import type { Metadata } from 'next';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpenCheck,
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
  title: 'Course tools for Lagos State University',
  description:
    'LASUATOS brings course setup and student enrollment into one clear, role-based workspace for Lagos State University.',
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
    title: 'Administrators oversee',
    description: 'See academic activity within the LASU scope assigned to your account.',
    icon: ShieldCheck,
  },
] as const;

const roleCards = [
  {
    id: 'student',
    label: 'FOR STUDENTS',
    title: 'Your courses, together.',
    description: 'Create your account, join a course with your lecturer’s code, and keep your current enrollments close at hand.',
    action: 'Create a student account',
    href: '/sign-up',
    icon: GraduationCap,
    tone: 'student',
  },
  {
    id: 'lecturer',
    label: 'FOR LECTURERS',
    title: 'Course tools that stay in scope.',
    description: 'Use your provisioned lecturer account to create course offerings and manage student enrollment codes.',
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
          <h1 id="hero-heading">Course coordination, <em>made clear.</em></h1>
          <p className="landing-lede">
            A shared course workspace for LASU. Lecturers organize offerings, students join with a
            course code, and administrators see the academic activity within their assigned scope.
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

        <div className="landing-visual" aria-label="How course enrollment works">
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
                <p className="course-flow-kicker">COURSE ENROLLMENT</p>
                <h2>A simpler start to the semester.</h2>
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
              <div><strong>Students join with a code</strong><small>Shared directly by their lecturer</small></div>
              <KeyRound size={17} aria-hidden="true" />
            </div>
            <div className="course-flow-foot"><span /> Accounts keep the right access for each role</div>
          </div>
          <div className="visual-side-note"><span>LASU</span><small>LEARN · TEACH · CONNECT</small></div>
        </div>
      </section>

      <section className="landing-steps-section" id="how-it-works" aria-labelledby="how-heading">
        <div className="landing-section-heading">
          <div>
            <p className="landing-section-kicker">A CLEARER COURSE FLOW</p>
            <h2 id="how-heading">The right tools for every role.</h2>
          </div>
          <p>One LASU workspace with simple, role-based paths from sign-in to course activity.</p>
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
          <ShieldCheck size={16} aria-hidden="true" /> Lecturer and administrator access is provisioned separately and checked against your account on the server.
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
