import type { Metadata } from 'next';
import { Clock3, FileSpreadsheet, KeyRound, Scale, UserCheck, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { PageToc } from '../../components/public/toc';
import { Tight } from '../../components/tight';
import '../pages.css';

export const metadata: Metadata = {
  title: 'Terms of use',
  description: 'The rules for using LASUATOS at Lagos State University: mark only yourself, keep your account to yourself, and keep the register true.',
};

const UPDATED = '10 November 2026';

const SECTIONS = [
  { id: 'who', label: 'Who these are for' },
  { id: 'account', label: 'Your account' },
  { id: 'attendance', label: 'Marking attendance' },
  { id: 'staff', label: 'Lecturers and class reps' },
  { id: 'misuse', label: 'Not allowed' },
  { id: 'breaking', label: 'If rules are broken' },
  { id: 'availability', label: 'Availability' },
  { id: 'data', label: 'Your data' },
  { id: 'changes', label: 'Changes and contact' },
] as const;

const RULES = [
  { icon: UserCheck, title: 'Mark only yourself', text: 'From inside the hall, with your own account. Never for a friend, and never let anyone use yours.' },
  { icon: KeyRound, title: 'Your account is yours', text: 'Keep your password and any setup code private. Tell your HOC if you think someone else got in.' },
  { icon: UsersRound, title: 'Staff: keep the record true', text: 'Add, remove or fix entries only for a real reason. Every change records who made it and why.' },
  { icon: FileSpreadsheet, title: 'Exports are University records', text: 'Downloaded or printed registers hold students’ data. Store and share them with care.' },
] as const;

export default function TermsPage() {
  return (
    <div className="pg">
      <header className="pg-hero">
        <div className="pg-wrap">
          <p className="pg-kicker">Terms of use</p>
          <h1 className="pg-title pg-title-wide"><Tight>Fair rules for an honest register.</Tight></h1>
          <p className="pg-lede">
            Using LASUATOS means agreeing to these rules. They’re short because the idea is simple: every mark on the register should be true, and nobody should be marked for someone else.
          </p>
          <div className="pg-meta">
            <span className="pg-pill"><Clock3 size={15} aria-hidden="true" /> Updated {UPDATED}</span>
            <span className="pg-pill"><Scale size={15} aria-hidden="true" /> Students and staff</span>
          </div>
        </div>
      </header>

      <div className="pg-wrap">
        <section className="pg-rules" aria-label="The short version">
          {RULES.map((rule, index) => {
            const Icon = rule.icon;
            return (
              <article key={rule.title}>
                <span className="pg-rule-n" aria-hidden="true">{index + 1}</span>
                <span className="pg-glance-icon" aria-hidden="true"><Icon size={20} /></span>
                <h2>{rule.title}</h2>
                <p>{rule.text}</p>
              </article>
            );
          })}
        </section>

        <div className="pg-doc">
          <PageToc items={SECTIONS} />
          <div className="pg-prose">
            <section id="who" className="pg-doc-section">
              <h2><span className="pg-n">01</span>Who these are for</h2>
              <p>
                LASUATOS is the lecture attendance system for Lagos State University, made at the Faculty of Engineering. These terms apply to everyone who uses it: students, lecturers, class representatives (HOCs and GHOCs) and administrators. They sit alongside the University’s own rules and policies, which always come first.
              </p>
            </section>

            <section id="account" className="pg-doc-section">
              <h2><span className="pg-n">02</span>Your account</h2>
              <ul className="pg-list">
                <li>Each student has one account, opened with their own matric number and LASU student email. Names come from the class list your HOC keeps.</li>
                <li>Keep your password private, and change it under Account security if you think someone knows it.</li>
                <li>A setup code from your HOC is for you alone. Don’t pass it on.</li>
                <li>On a phone that isn’t yours, leave <em>This is my phone: keep me signed in</em> off, so you aren’t left signed in.</li>
                <li>Staff accounts are by invitation only and must not be shared.</li>
              </ul>
            </section>

            <section id="attendance" className="pg-doc-section">
              <h2><span className="pg-n">03</span>Marking attendance</h2>
              <ul className="pg-list">
                <li>Mark attendance only for yourself, only for a class you’re actually in, and only while you’re there.</li>
                <li>If your phone is dead, you may sign in on a classmate’s phone to mark yourself. That’s what the option is for.</li>
                <li>Don’t send the code or a photo of the QR code to anyone outside the hall.</li>
                <li>Don’t try to fool the face or location checks, for example with a photo, a video, a mask or a fake-location app.</li>
              </ul>
              <div className="pg-callout">
                <UserCheck size={20} aria-hidden="true" />
                <p>Being marked present when you weren’t there is the same as signing a paper register for someone else, and the University treats it the same way.</p>
              </div>
            </section>

            <section id="staff" className="pg-doc-section">
              <h2><span className="pg-n">04</span>Lecturers and class reps</h2>
              <ul className="pg-list">
                <li>Run attendance only for courses you teach, or that you represent as a class rep.</li>
                <li>Add, remove or edit entries only for a real reason, and give that reason when asked. Students are told when their entry is removed.</li>
                <li>Class reps add classmates by hand only within the limits shown: while attendance is open, from inside the hall.</li>
                <li>HOCs keep their class list accurate, and give setup codes only to the student themselves, in person.</li>
                <li>Registers you export or print contain personal data. Keep them only as long as you need them, and share them only with people entitled to see them.</li>
              </ul>
            </section>

            <section id="misuse" className="pg-doc-section">
              <h2><span className="pg-n">05</span>Not allowed</h2>
              <ul className="pg-list pg-list-no">
                <li>Signing in as someone else, or helping someone to.</li>
                <li>Trying to see data you aren’t entitled to, or testing the system’s security without permission.</li>
                <li>Using scripts or tools to mark attendance, collect data or overload the service.</li>
                <li>Uploading false class lists or names.</li>
              </ul>
            </section>

            <section id="breaking" className="pg-doc-section">
              <h2><span className="pg-n">06</span>If rules are broken</h2>
              <p>
                Wrong entries can be removed, and failed or suspicious attempts are recorded. Access can be restricted, and the matter can be passed to your department or the University under its own procedures. A flag in LASUATOS, such as “Same phone as …” or a loose face match, is a prompt for a person to look, not a finding against anyone.
              </p>
            </section>

            <section id="availability" className="pg-doc-section">
              <h2><span className="pg-n">07</span>Availability</h2>
              <p>
                We work to keep LASUATOS fast and available, but like any online service it can sometimes be unreachable, for example during maintenance or when your connection drops. If you can’t mark attendance, tell the person taking it while attendance is still open. They can add you.
              </p>
            </section>

            <section id="data" className="pg-doc-section">
              <h2><span className="pg-n">08</span>Your data</h2>
              <p>
                What LASUATOS records, who can see it and your rights are explained in the <Link href="/privacy">Privacy notice</Link>. Attendance records belong to the University and are kept under its records policy.
              </p>
            </section>

            <section id="changes" className="pg-doc-section">
              <h2><span className="pg-n">09</span>Changes and contact</h2>
              <p>If these terms change, the date at the top changes too. The latest version is always on this page.</p>
              <p>Questions? See the <Link href="/help">Help centre</Link>, contact your department’s LASUATOS administrator, or <Link href="/contact">write to the LASUATOS team</Link>.</p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
