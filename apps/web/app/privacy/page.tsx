import type { Metadata } from 'next';
import {
  BadgeCheck,
  Ban,
  Clock3,
  EyeOff,
  Fingerprint,
  Mail,
  MapPin,
  ScanFace,
  ShieldCheck,
  UserRoundCheck,
} from 'lucide-react';
import Link from 'next/link';
import { PageToc } from '../../components/public/toc';
import { Tight } from '../../components/tight';
import '../pages.css';

export const metadata: Metadata = {
  title: 'Privacy notice',
  description:
    'What LASUATOS records when you mark attendance, who can see it, how long it is kept, and your rights under the Nigeria Data Protection Act 2023.',
};

const UPDATED = '18 November 2026';

const SECTIONS = [
  { id: 'what', label: 'What we record' },
  { id: 'never', label: 'What we never collect' },
  { id: 'why', label: 'Why we use it' },
  { id: 'who', label: 'Who can see it' },
  { id: 'device', label: 'Your phone and location' },
  { id: 'services', label: 'Services we use' },
  { id: 'keep', label: 'How long we keep it' },
  { id: 'rights', label: 'Your rights' },
  { id: 'security', label: 'How it’s protected' },
  { id: 'changes', label: 'Changes and contact' },
] as const;

const GLANCE = [
  { icon: UserRoundCheck, title: 'Only what attendance needs', text: 'Your name, matric number, the class and the time. Nothing from your contacts, gallery or phone number.' },
  { icon: ScanFace, title: 'Your face stays with us', text: 'Checked on LASUATOS’s own server. It’s never sold or sent to a face-recognition company.' },
  { icon: MapPin, title: 'Location once, never tracked', text: 'Asked only at the moment you mark attendance for a class in a registered hall.' },
  { icon: EyeOff, title: 'Classmates can’t see it', text: 'Your attendance is visible to you, the person who took it, your class reps and their assistants, and administrators in your area.' },
  { icon: Clock3, title: 'Faces are deleted on time', text: 'Automatically, about a year after your set finishes. Check-in photos after 90 days.' },
  { icon: BadgeCheck, title: 'You stay in control', text: 'Ask to see, correct or delete your data, or withdraw consent for your face.' },
] as const;

const RECORDS = [
  {
    when: 'Your HOC uploads the class list',
    what: 'Your matric number (or your JAMB registration number until you have one), surname, first and middle names, your set and level and, if they have it, your LASU student email, with who added or changed them and when.',
  },
  {
    when: 'You open your account',
    what: 'Your LASU student email, confirmed with a one-time code. If you’re on the list by JAMB number and have no LASU email yet, a personal email you confirm instead. Your password is stored only as a secure one-way hash, so nobody can read it, including us.',
  },
  {
    when: 'You sign in on a phone',
    what: 'A scrambled copy of your sign-in key, when that sign-in started and when it was last used. Not the phone’s name, its address on the internet or the browser.',
  },
  {
    when: 'You register your face',
    what: 'Face measurements (numbers computed from three photos, not the photos themselves) and one small photo of you facing the camera. The other photos are discarded straight away. Only with your consent.',
  },
  {
    when: 'You mark attendance',
    what: 'The name and matric number on your account, the class, the time, whether you scanned or typed the code, the face match score and the result of the check that it was a live face, not a photo.',
  },
  {
    when: 'Your face matches only loosely',
    what: 'One small photo from that check-in, kept with that lecture’s attendance so a lecturer or administrator can compare it with your registered face. Otherwise the camera photos are discarded once checked.',
  },
  {
    when: 'A class is linked to a hall',
    what: 'The position your phone reported at that moment, how accurate it was, and how far you were from the hall.',
  },
  {
    when: 'You ask for help at a lecture',
    what: 'If your face check fails twice, you can ask the person taking attendance to add you. The request holds your name and matric number, why the check failed and how many times, whether your phone placed you in the hall, and their answer (added or declined) with who gave it.',
  },
  {
    when: 'You dispute a record or appeal',
    what: 'What you write (up to 1,000 characters), the lecturer’s decision and note and, if you appeal to your department, your appeal and the administrator’s decision. A change it makes to your attendance is recorded with the reason.',
  },
  {
    when: 'Someone corrects a list',
    what: 'Who added, removed, released or changed an entry, when, and the reason they gave.',
  },
  {
    when: 'You contact us',
    what: 'Your name, email and message and, for a problem report if you switch it on, your browser and phone system (for example “Chrome 131 · Android 14”).',
  },
  {
    when: 'Staff accounts',
    what: 'Name, email, department, role and the sessions they ran.',
  },
] as const;

const RETENTION = [
  { time: '15 to 30 minutes', text: 'Email codes, setup codes from your HOC and password-reset links work this long. They are deleted within two days of expiring.' },
  { time: 'Up to 30 days', text: 'A sign-in on a phone, unless you sign out sooner. Ended sign-ins are deleted within two days, except your latest one, which only shows when you last used LASUATOS.' },
  { time: '30 days', text: 'System health alerts. They describe faults and hold no names, emails or matric numbers.' },
  { time: '90 days', text: 'Check-in photos kept because a face matched only loosely.' },
  { time: '12 months after your set finishes', text: 'Your registered face, unless you checked in during the last 180 days (an extra year or carry-over courses).' },
  { time: 'A year after it’s handled', text: 'A message sent through the contact page. Any message is deleted after two years.' },
  { time: 'University records policy', text: 'Your account, class-list entry, attendance records, help requests, disputes and appeals, for academic records and appeals. The audit trail of changes is kept with them.' },
] as const;

function Receipt() {
  return (
    <figure className="pg-receipt" aria-label="Example: what one check-in stores">
      <div className="pg-receipt-paper">
        <p className="pg-receipt-head">One check-in</p>
        <p className="pg-receipt-sub">MEE 301 · Lecture Theatre 2</p>
        <dl>
          <div><dt>Student</dt><dd>OKAFOR Chidinma</dd></div>
          <div><dt>Matric</dt><dd>220591034</dd></div>
          <div><dt>Time</dt><dd>08:02:14</dd></div>
          <div><dt>Method</dt><dd>QR scan</dd></div>
          <div><dt>Face match</dt><dd>Clear</dd></div>
          <div><dt>Hall</dt><dd>Inside · ±12 m</dd></div>
        </dl>
        <p className="pg-receipt-label">Not stored</p>
        <ul className="pg-receipt-strike">
          <li>Phone number</li>
          <li>Contacts &amp; photos</li>
          <li>Where you go after class</li>
          <li>Adverts &amp; trackers</li>
        </ul>
        <p className="pg-receipt-total"><span>Status</span><strong>PRESENT</strong></p>
      </div>
      <figcaption className="sr-only">An example record: name, matric number, time, method, face match result and distance from the hall. Phone number, contacts, photos, movements and trackers are not stored.</figcaption>
    </figure>
  );
}

export default function PrivacyPage() {
  return (
    <div className="pg">
      <header className="pg-hero">
        <div className="pg-wrap pg-hero-split">
          <div>
            <h1 className="pg-title"><Tight>Your data, in plain words.</Tight></h1>
            <p className="pg-lede">
              LASUATOS records lecture attendance for Lagos State University. Here is exactly what it records, why, who can see it, how long it’s kept, and what you can ask for under the Nigeria Data Protection Act 2023.
            </p>
            <div className="pg-meta">
              <span className="pg-pill"><Clock3 size={15} aria-hidden="true" /> Updated {UPDATED}</span>
              <span className="pg-pill"><ShieldCheck size={15} aria-hidden="true" /> NDPA 2023</span>
            </div>
          </div>
          <Receipt />
        </div>
      </header>

      <div className="pg-wrap">
        <section className="pg-glance" aria-label="At a glance">
          {GLANCE.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.title}>
                <span className="pg-glance-icon" aria-hidden="true"><Icon size={20} /></span>
                <h2>{item.title}</h2>
                <p>{item.text}</p>
              </article>
            );
          })}
        </section>

        <div className="pg-doc">
          <PageToc items={SECTIONS} />
          <div className="pg-prose">
            <section id="what" className="pg-doc-section">
              <h2><span className="pg-n">01</span>What we record</h2>
              <p>Only what is needed to keep an honest register. Here is each moment something is saved.</p>
              <dl className="pg-records">
                {RECORDS.map((row) => (
                  <div key={row.when}>
                    <dt>{row.when}</dt>
                    <dd>{row.what}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section id="never" className="pg-doc-section">
              <h2><span className="pg-n">02</span>What we never collect</h2>
              <ul className="pg-list pg-list-no">
                <li>Your phone number, contacts, photo gallery or other apps.</li>
                <li>Your location outside the moment you mark attendance. There’s no background tracking.</li>
                <li>The device name, IP address or browser of your sign-ins. Short-lived security counters that slow down password guessing hold only a scrambled code and expire on their own. Our server logs leave your IP address out.</li>
                <li>Anything for advertising. There are no adverts, tracking pixels or analytics scripts on LASUATOS, and no scripts from other companies at all.</li>
              </ul>
              <div className="pg-callout">
                <Ban size={20} aria-hidden="true" />
                <p>Your data is never sold, and never used to market anything to you.</p>
              </div>
            </section>

            <section id="why" className="pg-doc-section">
              <h2><span className="pg-n">03</span>Why we use it</h2>
              <p>
                To keep an accurate record of who attended each lecture, so that lecturers, class reps and departments can work out attendance for exam eligibility (commonly 75%), and so you can see your own record. This is part of the University’s teaching and assessment work, a public-interest and legitimate purpose under the Act.
              </p>
              <p>
                Your face is sensitive personal data. It is used only to confirm that the person marking attendance is the account’s owner, and only with your explicit consent, which you give when you register it.
              </p>
            </section>

            <section id="who" className="pg-doc-section">
              <h2><span className="pg-n">04</span>Who can see it</h2>
              <ul className="pg-list">
                <li><strong>You:</strong> your own check-ins and percentages, under <Link href="/attendance">My attendance</Link>.</li>
                <li><strong>The lecturer or class rep who ran a session:</strong> that session’s list, and the register for their course. For a hall check, they see whether you were inside and how far away you were, never your position on a map. If you ask for help at their lecture, they see the request with your registered photo.</li>
                <li><strong>Class reps’ assistants (AHOC and AGHOC):</strong> the same as a class rep while taking attendance. Their HOC or GHOC decides whether they can also see the class’s registers and keep the class list.</li>
                <li><strong>The course’s lecturers:</strong> a dispute you raise about one of their classes. If you appeal, the administrators of the department that runs the course decide, and faculty and university administrators can see it too.</li>
                <li><strong>Your HOC and administrators in your area:</strong> your class-list entry, whether you’ve opened your account, and your registered face photo, so they can spot the wrong person. HOCs and GHOCs can also view the sessions in their department or faculty.</li>
                <li><strong>Lecturers and administrators reviewing a loose face match:</strong> the photo kept from that check-in, next to your registered photo.</li>
              </ul>
              <p>Other students can’t see your attendance. Lists that staff export to Excel or print are University records and are covered by its policies. University administrators also see System health, which reports faults such as an email that could not be sent and holds no personal data.</p>
            </section>

            <section id="device" className="pg-doc-section">
              <h2><span className="pg-n">05</span>Your phone and location</h2>
              <div className="pg-subs">
                <article>
                  <h3><Fingerprint size={18} aria-hidden="true" /> A random device code</h3>
                  <p>Your browser keeps a random code, so that one phone marking many different students in the same lecture can be noticed. We store only a scrambled version that is different for every lecture, so it can’t be used to follow your phone around.</p>
                </article>
                <article>
                  <h3><MapPin size={18} aria-hidden="true" /> Location, once</h3>
                  <p>If a class is linked to a hall, your phone is asked for its location once, when you mark attendance, to check you’re in the hall. If the lecturer made the hall check required, attendance can’t be marked without it. An imprecise reading still counts.</p>
                </article>
                <article>
                  <h3><ShieldCheck size={18} aria-hidden="true" /> One sign-in cookie</h3>
                  <p>It keeps you signed in and can’t be read by scripts on the page. If you install the app, some pages are stored on your phone so it opens faster. Attendance data is never stored for offline use.</p>
                </article>
                <article>
                  <h3><Mail size={18} aria-hidden="true" /> Your LASU mail, only on your phone</h3>
                  <p>If you connect LASU mail, Google lets this page read your LASU inbox, never send, delete or change it. Your emails go from Google straight to your phone and stay there only while the page is open. They never pass through or stay on LASUATOS’s servers. Disconnect any time, and signing out forgets the connection on that phone.</p>
                </article>
              </div>
            </section>

            <section id="services" className="pg-doc-section">
              <h2><span className="pg-n">06</span>Services we use</h2>
              <p>LASUATOS runs on a few trusted services. Each one processes data only to provide its part, under its own data-protection terms.</p>
              <div className="pg-procs">
                <article><strong>Vercel</strong><span>Hosts the website and runs the server, including the face check. Like any web host, it briefly logs each request (the page, your IP address and browser) to keep the site running. Those logs are deleted within a day.</span><small>Frankfurt, Germany</small></article>
                <article><strong>Neon</strong><span>The database where records are stored, encrypted at rest.</span><small>Frankfurt, Germany</small></article>
                <article><strong>Brevo</strong><span>Sends account emails, such as codes and notices. It receives your email address and the message.</span><small>European Union</small></article>
                <article><strong>Google</strong><span>Gmail sends account emails when Brevo can’t. If you use Continue with Google, Google tells us your email address only. If you connect LASU mail, your emails come from Google to your phone and never to us.</span><small>Worldwide</small></article>
              </div>
              <p>Because these services are outside Nigeria, your data is transferred to the European Union, which has data-protection law of its own. Nothing is shared with anyone else, except where the law requires it.</p>
            </section>

            <section id="keep" className="pg-doc-section">
              <h2><span className="pg-n">07</span>How long we keep it</h2>
              <ol className="pg-timeline">
                {RETENTION.map((row) => (
                  <li key={row.time}>
                    <strong>{row.time}</strong>
                    <span>{row.text}</span>
                  </li>
                ))}
              </ol>
              <p>These deletions run automatically every night, and face deletions are written to the audit log. Your face is also deleted when an administrator resets it or releases your account, or when you withdraw consent.</p>
            </section>

            <section id="rights" className="pg-doc-section">
              <h2><span className="pg-n">08</span>Your rights</h2>
              <p>Under the Nigeria Data Protection Act 2023 you can ask to:</p>
              <ul className="pg-list pg-list-check">
                <li>see the data held about you;</li>
                <li>correct something that’s wrong, such as a misspelt name or matric number;</li>
                <li>have data deleted when it’s no longer needed, or object to how it’s used;</li>
                <li>receive your data in a portable format;</li>
                <li>withdraw consent for your face. An administrator deletes it, and you’re then marked only when the person taking attendance adds you.</li>
              </ul>
              <p>
                For an attendance entry, speak first to the lecturer or class rep who ran the session, because they can fix it straight away. For your name or matric number, speak to your HOC. For anything else, contact your department’s or faculty’s LASUATOS administrator, or send a <Link href="/contact?topic=privacy">privacy request</Link> to the LASUATOS team. If you’re not satisfied, you can complain to the Nigeria Data Protection Commission (NDPC).
              </p>
            </section>

            <section id="security" className="pg-doc-section">
              <h2><span className="pg-n">09</span>How it’s protected</h2>
              <ul className="pg-list">
                <li>All traffic is encrypted (HTTPS), and passwords are stored only as salted one-way hashes.</li>
                <li>Sign-in and codes are rate-limited. Live QR codes change every 30 seconds.</li>
                <li>New face photos need your password and a code to your LASU email, so a phone thief can’t swap in their own face.</li>
                <li>Every manual change to a list, every face review and every account release is recorded with who did it, and that record can’t be edited.</li>
                <li>If your password is reset, or your account is reopened or released, you get an email about it.</li>
              </ul>
            </section>

            <section id="changes" className="pg-doc-section">
              <h2><span className="pg-n">10</span>Changes and contact</h2>
              <p>If this notice changes, the date at the top changes too. The latest version is always on this page.</p>
              <p>Questions? See the <Link href="/help">Help centre</Link>, read the <Link href="/terms">Terms of use</Link>, or <Link href="/contact">contact us</Link>.</p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
