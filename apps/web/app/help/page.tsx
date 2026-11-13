import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Help',
  description: 'How to mark attendance, take attendance, print QR posters, add a student by hand, and export course registers on LASUATOS.',
};

type Faq = { q: string; a: ReactNode };

const STUDENTS: Faq[] = [
  {
    q: 'How do I mark my attendance?',
    a: <>Open your phone camera and point it at the QR code on the screen or poster, then tap the link. Or open <Link href="/a">lasuatos.vercel.app/a</Link> and tap <em>Scan QR code</em>. Sign in with your student account (email or matric number) the first time — after that it is one tap.</>,
  },
  {
    q: 'Do I need an account?',
    a: <>Yes. Each student marks only themselves, with their own account, so nobody can mark you present (or absent friends) by typing a name. <Link href="/sign-up">Create one</Link> once; it also shows your attendance percentage for every course under <Link href="/attendance">My attendance</Link>. Check-ins made before you had an account are matched by your matric number.</>,
  },
  {
    q: 'The QR code won’t scan.',
    a: <>Type the code shown under the QR code instead, on <Link href="/a">the check-in page</Link>. Live codes change every 30 seconds, so type the one on screen now. Clean your camera lens and move closer if scanning is slow.</>,
  },
  {
    q: 'My phone is dead / I don’t have a smartphone.',
    a: 'Borrow a classmate’s phone: after scanning, tap “A classmate without their phone? Let them sign in here” and sign in with your own email or matric number and password. It marks only you and does not change their phone. A phone can mark its owner and one classmate per class. Otherwise tell the class rep while attendance is still open, or the lecturer.',
  },
  {
    q: 'My name or matric number is wrong on the list.',
    a: 'Your entry uses the name and matric number on your account. Correct them in Password and sign-in. If the lecturer or class rep added you by hand with a typo, ask them to fix it.',
  },
  {
    q: 'It says my attendance was removed.',
    a: 'The person taking attendance removed the entry (for example, if they believed you were not in class). Speak to them — they can put it back in one tap.',
  },
  {
    q: 'How is my percentage worked out?',
    a: 'Lectures you attended ÷ lectures held for that course by the lecturers and class reps whose sessions you attended. Most departments require 75% to sit the exam. The bar on each course shows where 75% is.',
  },
];

const STAFF: Faq[] = [
  {
    q: 'How do I take attendance?',
    a: <>Open <Link href="/sessions">Take attendance</Link>, tap <em>New session</em>, pick the course from the list (add it once if it is missing), choose how long attendance stays open, and show the QR code. Students scan it; names appear on your screen as they come in.</>,
  },
  {
    q: 'Live QR or printed poster?',
    a: 'Live (dynamic) QR changes every 30 seconds, so a photo sent to friends outside the hall stops working — best on a projector. Printed (static) QR stays the same for the session — print or download the poster for halls without a projector. You can switch at any time.',
  },
  {
    q: 'Showing the code on a projector',
    a: 'Tap Full screen (or press F on a laptop). The screen stays awake while the QR is showing.',
  },
  {
    q: 'A student’s phone is dead',
    a: 'The student can sign in on a classmate’s phone just for the check-in. Or, on the session page, tap Add student and enter their name and matric number. Class reps can do this only while attendance is open, from inside the venue, for up to 10 students. Lecturers can also add after the session closes; those entries are marked “Added after class”.',
  },
  {
    q: 'Spotting and removing wrong entries',
    a: 'Entries made from the same phone are flagged “Same phone as …”. Tap the remove button and choose a reason; the student is told their entry was removed. You can put an entry back later.',
  },
  {
    q: 'A student typed their name or matric number wrongly',
    a: 'Tap the pencil next to their entry and fix it. If the corrected matric number belongs to a student account, the entry moves to that account so it shows in their history. Entries made with an account take the details from the account.',
  },
  {
    q: 'I opened a session by mistake',
    a: 'On the session page, tap Delete session at the bottom of the controls. If anyone has already marked attendance, you type the course code to confirm, because deleting takes them off the register.',
  },
  {
    q: 'Closing early or giving more time',
    a: 'Close attendance stops new check-ins immediately. You can reopen it for a few more minutes from the same page.',
  },
  {
    q: 'Course registers and exam eligibility',
    a: <>Open <Link href="/registers">Registers</Link> to see every student against every session of a course, with percentages. Filter those below 75% (or another threshold), export to Excel, or print an A4 register. On the sessions page, search by course code or title to find older sessions.</>,
  },
  {
    q: 'Class representatives (GHOC / HOC)',
    a: 'An administrator appoints a GHOC for a faculty and entry year; the GHOC appoints HOCs for departments. Class reps can run attendance sessions the same way lecturers do. A HOC can also view every session taken in their department, and a GHOC every session in their faculty — view only, with the list and export, but changes stay with whoever took the session.',
  },
];

function FaqList({ items }: Readonly<{ items: Faq[] }>) {
  return (
    <div className="doc-faqs">
      {items.map((item) => (
        <details key={item.q} className="doc-faq">
          <summary>{item.q}</summary>
          <div className="doc-faq-body">{item.a}</div>
        </details>
      ))}
    </div>
  );
}

export default function HelpPage() {
  return (
    <article className="doc-page">
      <header className="doc-head">
        <p className="page-eyebrow">HELP</p>
        <h1>How LASUATOS works</h1>
        <p className="page-lede">Quick answers for students, lecturers and class representatives.</p>
      </header>

      <ol className="doc-steps" aria-label="Attendance in three steps">
        <li><strong>Lecturer opens a session</strong><span>Course code, how long it stays open, show the QR.</span></li>
        <li><strong>Students scan</strong><span>Signed in once with their own account. No app needed.</span></li>
        <li><strong>Register builds itself</strong><span>Percentages per student, export to Excel or print.</span></li>
      </ol>

      <section className="doc-section" aria-labelledby="help-students">
        <h2 id="help-students">For students</h2>
        <FaqList items={STUDENTS} />
      </section>

      <section className="doc-section" aria-labelledby="help-staff">
        <h2 id="help-staff">For lecturers and class reps</h2>
        <FaqList items={STAFF} />
      </section>

      <section className="doc-section" aria-labelledby="help-app">
        <h2 id="help-app">Install it like an app</h2>
        <p>
          On Android (Chrome), open the menu and tap <em>Install app</em> or <em>Add to Home screen</em>. On iPhone (Safari), tap Share, then
          <em> Add to Home Screen</em>. On a laptop (Chrome or Edge), click the install icon in the address bar. It then opens full-screen with its own icon.
        </p>
      </section>

      <footer className="doc-foot">
        <p>Read the <Link href="/privacy">privacy notice</Link> to see what is recorded and who can see it.</p>
      </footer>
    </article>
  );
}
