import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy notice',
  description: 'What LASUATOS records when you mark attendance, who can see it, and your rights under the Nigeria Data Protection Act 2023.',
};

const UPDATED = '10 November 2026';

export default function PrivacyPage() {
  return (
    <article className="doc-page">
      <header className="doc-head">
        <p className="page-eyebrow">PRIVACY NOTICE</p>
        <h1>Your data on LASUATOS</h1>
        <p className="page-lede">
          LASUATOS records lecture attendance for Lagos State University. This notice explains, in plain words, what is recorded,
          why, who can see it, and what you can ask for under the Nigeria Data Protection Act 2023.
        </p>
        <p className="doc-updated">Last updated {UPDATED}</p>
      </header>

      <nav className="doc-toc" aria-label="On this page">
        <a href="#what">What we record</a>
        <a href="#why">Why</a>
        <a href="#who">Who can see it</a>
        <a href="#device">Your phone and location</a>
        <a href="#keep">How long</a>
        <a href="#rights">Your rights</a>
        <a href="#security">Security</a>
      </nav>

      <section id="what" className="doc-section">
        <h2>What we record</h2>
        <div className="doc-table" role="table" aria-label="Data recorded">
          <div role="row" className="doc-row doc-row-head">
            <span role="columnheader">When</span><span role="columnheader">What is recorded</span>
          </div>
          <div role="row" className="doc-row">
            <span role="cell"><strong>You mark attendance</strong></span>
            <span role="cell">The full name and matric number on your account, the course, the time, and whether you scanned the QR code or typed the code.</span>
          </div>
          <div role="row" className="doc-row">
            <span role="cell"><strong>Your HOC uploads the class list</strong></span>
            <span role="cell">Your matric number, surname, first and middle names, and (if they have it) your LASU student email, with who added or changed them and when.</span>
          </div>
          <div role="row" className="doc-row">
            <span role="cell"><strong>You open your account</strong></span>
            <span role="cell">Your LASU student email, confirmed with a one-time code. Your password is stored only as a secure one-way hash — nobody can read it.</span>
          </div>
          <div role="row" className="doc-row">
            <span role="cell"><strong>You register your face</strong></span>
            <span role="cell">Face measurements (numbers computed from three photos, not the photos themselves) and one small photo of you facing the camera. The other photos are discarded straight away. Only with your consent.</span>
          </div>
          <div role="row" className="doc-row">
            <span role="cell"><strong>Your face is checked at a class</strong></span>
            <span role="cell">The match score. The camera photos are discarded once checked, except when the match is close but not clear: then one small photo is kept with that lecture’s attendance so the person who took it can compare.</span>
          </div>
          <div role="row" className="doc-row">
            <span role="cell"><strong>A lecturer corrects the list</strong></span>
            <span role="cell">Who removed or added a student, when, and the reason they gave.</span>
          </div>
          <div role="row" className="doc-row">
            <span role="cell"><strong>Staff accounts</strong></span>
            <span role="cell">Name, email, staff number, department, and the sessions they ran.</span>
          </div>
        </div>
        <p>We do <strong>not</strong> collect your phone number, contacts, or anything from your phone beyond what is listed here. Face checks run on LASUATOS’s own server; no face data goes to any other company. There are no adverts and no third-party tracking.</p>
      </section>

      <section id="why" className="doc-section">
        <h2>Why</h2>
        <p>
          To keep an accurate record of who attended each lecture, so that lecturers, class representatives and departments can
          compute attendance for exam eligibility (commonly 75%), and so that you can see your own attendance. This is part of
          the University’s teaching and assessment work (a public-interest and legitimate purpose under the Act). Your data is
          never sold or used for marketing.
        </p>
      </section>

      <section id="who" className="doc-section">
        <h2>Who can see it</h2>
        <ul className="doc-list">
          <li><strong>You</strong> — your own check-ins and percentages, under <Link href="/attendance">My attendance</Link> once you have an account.</li>
          <li><strong>The lecturer or class rep (HOC/GHOC) who ran the session</strong> — the list for that session and the register for their course.</li>
          <li><strong>University administrators</strong> — sessions within the faculty or department they manage.</li>
          <li><strong>Your HOC and administrators</strong> — your class-list entry, whether you have opened your account, and your registered face photo, so they can spot a wrong person.</li>
        </ul>
        <p>Other students cannot see your attendance. Lists exported to Excel by staff are the University’s records and are covered by its policies.</p>
      </section>

      <section id="device" className="doc-section">
        <h2>Your phone and location</h2>
        <ul className="doc-list">
          <li>
            <strong>A random device code.</strong> Your browser keeps a random code so that one phone marking many different students
            in the same lecture can be noticed. We store only a scrambled (hashed) version that is different for every lecture,
            so it cannot be used to follow your phone around.
          </li>
          <li>
            <strong>Location — only for lectures linked to a venue.</strong> If a lecturer links a session to a lecture venue, your phone is
            asked for its location once, at the moment you mark attendance, to check you were near the venue. It is never tracked
            in the background. If the lecturer made the venue check required, attendance cannot be marked without it; otherwise you
            can decline. An imprecise location still counts as present.
          </li>
          <li>
            <strong>Cookies.</strong> One sign-in cookie keeps you signed in (it cannot be read by scripts). If you install the app,
            some pages are stored on your phone so it opens faster. Attendance data is never stored for offline use.
          </li>
        </ul>
      </section>

      <section id="keep" className="doc-section">
        <h2>How long we keep it</h2>
        <p>
          Attendance records are kept for as long as the University needs them for academic records and for resolving appeals,
          in line with its records policy. Accounts stay until they are closed; your face data is deleted with your account, or
          earlier on request. Email codes expire after 15 minutes. Short-lived security data, such as rate-limit counters,
          expires automatically.
        </p>
      </section>

      <section id="rights" className="doc-section">
        <h2>Your rights</h2>
        <p>Under the Nigeria Data Protection Act 2023 you can ask to:</p>
        <ul className="doc-list doc-list-compact">
          <li>see the data held about you;</li>
          <li>correct something that is wrong (for example a misspelt name or matric number);</li>
          <li>have data deleted when it is no longer needed, or object to how it is used;</li>
          <li>receive your data in a portable format;</li>
          <li>withdraw consent for your face: an administrator deletes it (you then mark attendance only when the person taking it adds you).</li>
        </ul>
        <p>
          For an attendance entry, speak first to the lecturer or class rep who ran the session — they can remove or add entries
          straight away. For anything else, contact your department or the faculty’s LASUATOS administrator. If you are not
          satisfied, you may complain to the Nigeria Data Protection Commission (NDPC).
        </p>
      </section>

      <section id="security" className="doc-section">
        <h2>Security</h2>
        <p>
          All traffic is encrypted (HTTPS). Passwords are hashed, sign-in is rate-limited, live (dynamic) QR codes change
          every 30 seconds, and every manual change to a list records who made it. Access is limited to the people listed above.
        </p>
      </section>

      <footer className="doc-foot">
        <p>Questions? See <Link href="/help">Help</Link> or contact your department.</p>
      </footer>
    </article>
  );
}
