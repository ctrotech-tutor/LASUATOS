import type { Metadata } from 'next';
import {
  ArrowRight,
  BookOpenCheck,
  GraduationCap,
  Laptop,
  LifeBuoy,
  ListChecks,
  MessageCircleQuestion,
  QrCode,
  ScanFace,
  ShieldCheck,
  Smartphone,
  TabletSmartphone,
  UserCog,
  UsersRound,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { InstallAppButton } from '../../components/install-app';
import { HelpSearch } from '../../components/public/help-search';
import { Tight } from '../../components/tight';
import '../pages.css';

export const metadata: Metadata = {
  title: 'Help centre',
  description:
    'Answers for students, lecturers, class reps and administrators: opening your account, marking attendance, the face check, QR codes, class lists and course registers on LASUATOS.',
};

type Faq = { readonly id: string; readonly q: string; readonly a: ReactNode };
type Topic = { readonly title: string; readonly faqs: readonly Faq[] };
type Audience = {
  readonly id: string;
  readonly title: string;
  readonly short: string;
  readonly lede: string;
  readonly icon: typeof GraduationCap;
  readonly topics: readonly Topic[];
};

const AUDIENCES: readonly Audience[] = [
  {
    id: 'students',
    title: 'For students',
    short: 'Students',
    lede: 'Opening your account, marking attendance, the face check and your record.',
    icon: GraduationCap,
    topics: [
      {
        title: 'Getting started',
        faqs: [
          {
            id: 'q-account',
            q: 'Do I need an account?',
            a: (
              <>
                <p>Yes. Each student marks only themselves, with their own account and a quick look at the camera, so nobody can mark you present, and you can’t be asked to mark anyone else.</p>
                <p>
                  <Link href="/sign-up">Open yours</Link> once with your matric number. Your HOC has already put your class on LASUATOS, so your name fills in by itself. A code goes to your LASU student email (yourname@st.lasu.edu.ng), then you take three quick photos for the face check. It takes about two minutes.
                </p>
              </>
            ),
          },
          {
            id: 'q-no-email',
            q: 'I can’t get into my LASU student email.',
            a: <p>Ask your HOC for a setup code. They create it on the Class list page and give it to you in person. You type it in place of the email code. It works for 30 minutes.</p>,
          },
          {
            id: 'q-matric',
            q: 'My matric number isn’t found, or my name is wrong.',
            a: <p>Names come from your class list, which your HOC keeps on LASUATOS, so you can’t type your own. Ask your HOC to add or correct you. It takes them a minute and updates straight away. Then open your account.</p>,
          },
          {
            id: 'q-password',
            q: 'What is my password?',
            a: (
              <p>
                When your account opens, it is <strong>LASU</strong> + your matric number + your <strong>SURNAME</strong> in capitals, like the LASU portal. For example: LASU250211184ODEJOBI. You’re never forced to change it, but you can at any time under Account security.
              </p>
            ),
          },
          {
            id: 'q-forgot',
            q: 'I forgot my password.',
            a: (
              <p>
                Use <Link href="/forgot-password">Forgot password</Link> with your matric number or email. A code goes to the LASU email on your account. If you can no longer reach that email, speak to your HOC: an administrator can check it’s really you and reopen the account for you.
              </p>
            ),
          },
        ],
      },
      {
        title: 'Marking attendance',
        faqs: [
          {
            id: 'q-mark',
            q: 'How do I mark my attendance?',
            a: (
              <ol>
                <li>Point your phone camera at the QR code on the screen or poster and tap the link. You can also open <Link href="/a">lasuatos.vercel.app/a</Link> and tap <em>Scan QR code</em>.</li>
                <li>Check that the course is the right one, then look at the camera and turn your head as asked.</li>
                <li>You’ll see <strong>Present</strong>. The first time on a phone you sign in; after that it’s one tap.</li>
              </ol>
            ),
          },
          {
            id: 'q-qr',
            q: 'The QR code won’t scan.',
            a: (
              <p>
                Type the code shown under the QR code on <Link href="/a">the check-in page</Link> instead. Live codes change every 30 seconds, so type the one on screen now. If scanning is slow, wipe your camera lens and move a little closer.
              </p>
            ),
          },
          {
            id: 'q-expired',
            q: 'It says the code has expired.',
            a: <p>The code on the projector changes every 30 seconds, so a photo of it sent to someone outside stops working. Scan the screen again, or type the code showing now. If the lecturer has closed attendance, no code will work. Speak to them.</p>,
          },
          {
            id: 'q-location',
            q: 'It asks for my location, or says I’m outside the hall.',
            a: (
              <>
                <p>For lectures linked to a venue, your phone is asked for its location once, at the moment you mark attendance, to confirm you’re in the hall. It is never tracked in the background.</p>
                <ul>
                  <li><strong>Android (Chrome):</strong> turn on Location, then tap the icon left of the address and allow Location for this site.</li>
                  <li><strong>iPhone:</strong> Settings → Privacy &amp; Security → Location Services → Safari Websites → <em>While Using</em>, with Precise Location on.</li>
                  <li>Give it a few seconds to get a good fix before you confirm.</li>
                </ul>
              </>
            ),
          },
          {
            id: 'q-phone-dead',
            q: 'My phone is dead, or I don’t have a smartphone.',
            a: (
              <p>
                Borrow a classmate’s phone. After scanning, tap <em>A classmate without their phone? Let them sign in here</em> and sign in with your own matric number or email and password. It marks only you and doesn’t change their phone. A phone can mark its owner and one classmate per class. Otherwise, tell the class rep while attendance is still open, or the lecturer.
              </p>
            ),
          },
        ],
      },
      {
        title: 'The face check',
        faqs: [
          {
            id: 'q-face-why',
            q: 'Why does it check my face?',
            a: <p>So that only you can mark your attendance. Even a friend who knows your password can’t do it. You register your face once with three photos. At each class you look at the camera and turn your head as asked. Faces are checked on LASUATOS’s own server and never go to any other company.</p>,
          },
          {
            id: 'q-face-fail',
            q: 'The face check keeps failing.',
            a: (
              <>
                <ul>
                  <li>Face a window or a light, so your face isn’t in shadow.</li>
                  <li>Hold the phone at eye level, about an arm’s length away, with your whole face inside the circle.</li>
                  <li>Turn your head slowly when asked, then hold still.</li>
                </ul>
                <p>After two failed tries you can ask the person taking attendance to add you. They see your registered photo and confirm it’s you in the room.</p>
              </>
            ),
          },
          {
            id: 'q-face-new',
            q: 'Can I change my registered face photos?',
            a: <p>Yes, under Account security. You need your password and a code sent to your LASU email. The new photos must still match your registered face, and you can change them twice in 30 days. If the registered face isn’t you at all, ask an administrator to reset it.</p>,
          },
        ],
      },
      {
        title: 'Your record',
        faqs: [
          {
            id: 'q-percentage',
            q: 'How is my percentage worked out?',
            a: (
              <p>
                Lectures you attended ÷ lectures held for that course. Most departments require 75% to sit the exam. The bar on each course under <Link href="/attendance">My attendance</Link> shows where 75% is.
              </p>
            ),
          },
          {
            id: 'q-removed',
            q: 'It says my attendance was removed.',
            a: <p>The person who took attendance removed the entry, for example because they believed you weren’t in class, and they gave a reason. Speak to them. They can put it back in one tap.</p>,
          },
        ],
      },
    ],
  },
  {
    id: 'lecturers',
    title: 'For lecturers',
    short: 'Lecturers',
    lede: 'Opening a session, showing the code, fixing the list and the course register.',
    icon: BookOpenCheck,
    topics: [
      {
        title: 'Taking attendance',
        faqs: [
          {
            id: 'q-take',
            q: 'How do I take attendance?',
            a: (
              <ol>
                <li>Open <Link href="/sessions">Take attendance</Link> and tap <em>New session</em>.</li>
                <li>Pick the course from the list. Today’s date and your name are filled in. Choose how long attendance stays open.</li>
                <li>Show the QR code. Names appear on your screen as students check in.</li>
              </ol>
            ),
          },
          {
            id: 'q-live-printed',
            q: 'Live QR or printed poster?',
            a: <p><strong>Live</strong> changes every 30 seconds, so a photo sent to friends outside the hall stops working. It’s best on a projector. <strong>Printed</strong> stays the same for the session, for halls without a projector: print or download the poster. You can switch at any time.</p>,
          },
          {
            id: 'q-projector',
            q: 'Showing the code on a projector',
            a: <p>Tap <em>Show full screen</em> (or press F on a laptop). The screen stays awake while the code is showing, and the time to the next code counts down under it.</p>,
          },
          {
            id: 'q-close',
            q: 'Closing early, or giving more time',
            a: <p><em>Close attendance</em> stops new check-ins at once. You can reopen it for a few more minutes from the same page.</p>,
          },
          {
            id: 'q-delete',
            q: 'I opened a session by mistake',
            a: <p>On the session page, tap <em>Delete session</em> at the bottom of the controls. If anyone has already checked in, you type the course code to confirm, because deleting takes them off the register.</p>,
          },
        ],
      },
      {
        title: 'Fixing the list',
        faqs: [
          {
            id: 'q-add',
            q: 'A student’s phone is dead',
            a: <p>The student can sign in on a classmate’s phone just for the check-in. Or tap <em>Add student</em> on the session page and enter their matric number (and their name, if they have no account). Lecturers can also add students after the session closes. Those entries are marked <em>Added after class</em>.</p>,
          },
          {
            id: 'q-help-request',
            q: 'A student says the face check won’t work',
            a: <p>After two failed tries, a student can ask you to add them. The request appears on your live session with their registered photo. Look up, check it’s them, then tap <em>Add</em> or <em>Decline</em>.</p>,
          },
          {
            id: 'q-same-phone',
            q: 'Spotting and removing wrong entries',
            a: <p>Entries made from the same phone are flagged <em>Same phone as …</em>. Tap remove and choose a reason, and the student is told. You can put an entry back later.</p>,
          },
          {
            id: 'q-face-review',
            q: 'What does “check face” mean on an entry?',
            a: (
              <p>
                The face matched, but not clearly. A small photo from the check-in is kept so you can compare it with the registered face on <Link href="/face-checks">Face checks</Link>. Approve it, or reject it with a reason, which removes the check-in. These photos are deleted after 90 days.
              </p>
            ),
          },
          {
            id: 'q-typo',
            q: 'A typed name or matric number is wrong',
            a: <p>Tap the pencil next to the entry and fix it. If the corrected matric number belongs to a student account, the entry moves to that account. Entries made with an account always use the account’s details.</p>,
          },
        ],
      },
      {
        title: 'Registers and exams',
        faqs: [
          {
            id: 'q-registers',
            q: 'Course registers and exam eligibility',
            a: (
              <p>
                <Link href="/registers">Registers</Link> shows every student against every session of a course, with percentages. Filter those below 75% (or 50, 60, 70 or 80%), export to Excel, or print an A4 register. Search by course code or title to find older sessions.
              </p>
            ),
          },
        ],
      },
    ],
  },
  {
    id: 'class-reps',
    title: 'For class reps',
    short: 'Class reps',
    lede: 'HOCs and GHOCs: the class list, setup codes and running a session.',
    icon: UsersRound,
    topics: [
      {
        title: 'Your role',
        faqs: [
          {
            id: 'q-rep-role',
            q: 'What can a HOC or GHOC do?',
            a: <p>An administrator appoints a GHOC for a faculty and entry year, and the GHOC appoints a HOC for each department. Class reps run attendance sessions the same way lecturers do. A HOC can also view every session in their department, and a GHOC every session in their faculty. That access is view only, with the list and export. Changes stay with whoever took the session.</p>,
          },
          {
            id: 'q-rep-add',
            q: 'Adding a classmate by hand',
            a: <p>Class reps can add a classmate only while attendance is open and only from inside the venue, up to 10 per session. Classmates without a phone can mark themselves on a friend’s phone with their own account. Anyone else needs the lecturer, who can add after class.</p>,
          },
        ],
      },
      {
        title: 'The class list',
        faqs: [
          {
            id: 'q-class-list',
            q: 'How do I put my class on LASUATOS?',
            a: (
              <>
                <p>
                  Open <Link href="/class-list">Class list</Link> and upload an Excel (.xlsx) or CSV file, or paste rows straight from a spreadsheet. Headings like “Matric No”, “Surname” and “Other names” are recognised. There’s a template if you’re starting from scratch.
                </p>
                <p>Each matric number can appear only once and must be digits of the right length. Names must be letters only. Changes take effect straight away, so a classmate you add can open their account at once.</p>
              </>
            ),
          },
          {
            id: 'q-setup-code',
            q: 'A classmate can’t receive the email code',
            a: <p>On Class list, open their entry and choose <em>Give setup code</em>. Give it to them in person. It works for 30 minutes. It can’t be used on an account that is already confirmed with a LASU email; that student resets their own password by email.</p>,
          },
        ],
      },
    ],
  },
  {
    id: 'admins',
    title: 'For administrators',
    short: 'Admins',
    lede: 'Staff, class reps, account problems, face checks and data retention.',
    icon: UserCog,
    topics: [
      {
        title: 'People',
        faqs: [
          {
            id: 'q-admin-staff',
            q: 'Inviting lecturers and administrators',
            a: <p>On <em>Staff</em>, invite by email. You can invite people at or below your own level, inside your own area. An institution admin can invite anyone in LASU, a faculty admin anyone in their faculty, and a department admin anyone in their department. Invitation links work for 7 days and can be resent.</p>,
          },
          {
            id: 'q-admin-reps',
            q: 'Appointing class reps',
            a: <p>On <em>Class reps</em>, appoint a GHOC for a faculty and entry year. The GHOC then appoints HOCs for each department, and the HOCs upload their class lists.</p>,
          },
          {
            id: 'q-admin-release',
            q: 'A student’s account was opened with the wrong email',
            a: <p>From the student’s class-list entry, choose <em>Release account</em>, enter the correct LASU email and give a reason. The account is signed out everywhere, its face is deleted and the corrected email goes on the list, so only the real student can open it again. The previous address is told. Attendance is kept, and the release is audited.</p>,
          },
        ],
      },
      {
        title: 'Oversight',
        faqs: [
          {
            id: 'q-admin-audit',
            q: 'Face checks and the audit log',
            a: <p><em>Face checks</em> lists check-ins whose face matched only loosely, for a lecturer or administrator to approve or reject. The <em>Audit log</em> records registrations, resets, failed checks, reviews, releases and class-list changes, filtered to your area. It can’t be edited.</p>,
          },
          {
            id: 'q-admin-retention',
            q: 'How data retention works',
            a: <p>Every night, registered faces are deleted 12 months after a set’s final session, unless the student checked in during the last 180 days. Check-in photos kept for review are deleted after 90 days. Accounts and attendance records are kept. <em>Data retention</em> shows what is due and when it last ran.</p>,
          },
        ],
      },
    ],
  },
];

const POPULAR = [
  { href: '#q-qr', label: 'QR code won’t scan' },
  { href: '#q-forgot', label: 'Forgot password' },
  { href: '#q-face-fail', label: 'Face check failing' },
  { href: '#q-matric', label: 'Matric not found' },
  { href: '#q-phone-dead', label: 'Phone is dead' },
] as const;

function countFaqs(audience: Audience): number {
  return audience.topics.reduce((total, topic) => total + topic.faqs.length, 0);
}

function QaIcon() {
  return (
    <span className="pg-qa-icon" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
    </span>
  );
}

export default function HelpPage() {
  return (
    <div className="pg">
      <header className="pg-hero pg-hero-center">
        <div className="pg-wrap">
          <p className="pg-kicker">Help centre</p>
          <h1 className="pg-title"><Tight>How can we help?</Tight></h1>
          <p className="pg-lede">Plain answers for students, lecturers, class reps and administrators. Start typing, or pick your role below.</p>
          <HelpSearch targetId="answers" />
          <div className="pg-chips" aria-label="Popular questions">
            <span>Popular:</span>
            {POPULAR.map((item) => (
              <a key={item.href} className="pg-chip" href={item.href}>{item.label}</a>
            ))}
          </div>
        </div>
      </header>

      <div className="pg-wrap">
        <nav className="pg-aud" aria-label="Help by role">
          {AUDIENCES.map((audience) => {
            const Icon = audience.icon;
            return (
              <a key={audience.id} className="pg-aud-card" href={`#${audience.id}`}>
                <span className="pg-aud-icon" aria-hidden="true"><Icon size={21} /></span>
                <strong>{audience.short}</strong>
                <span className="pg-aud-text">{audience.lede}</span>
                <span className="pg-aud-count">{countFaqs(audience)} answers <ArrowRight size={15} aria-hidden="true" /></span>
              </a>
            );
          })}
        </nav>

        <section className="pg-start" aria-labelledby="start-title">
          <div className="pg-start-head">
            <p className="pg-kicker pg-kicker-light">New student?</p>
            <h2 id="start-title">Ready for your next lecture in two minutes.</h2>
          </div>
          <ol className="pg-start-steps">
            <li>
              <span className="pg-start-n">1</span>
              <div><strong>Open your account</strong><span>Your matric number and a code to your LASU email.</span></div>
            </li>
            <li>
              <span className="pg-start-n">2</span>
              <div><strong>Register your face</strong><span>Three quick photos, once.</span></div>
            </li>
            <li>
              <span className="pg-start-n">3</span>
              <div><strong>Scan in class</strong><span>Point your camera at the code. Done.</span></div>
            </li>
          </ol>
          <div className="pg-start-actions">
            <Link className="pg-btn pg-btn-gold" href="/sign-up">Open my account <ArrowRight size={17} aria-hidden="true" /></Link>
            <Link className="pg-btn pg-btn-onDark" href="/a"><QrCode size={17} aria-hidden="true" /> Mark attendance</Link>
          </div>
        </section>

        <div id="answers" className="pg-answers">
          {AUDIENCES.map((audience) => {
            const Icon = audience.icon;
            return (
              <section key={audience.id} id={audience.id} className="pg-aud-section" data-faq-group aria-labelledby={`${audience.id}-title`}>
                <header className="pg-aud-head">
                  <span className="pg-aud-icon" aria-hidden="true"><Icon size={22} /></span>
                  <div>
                    <h2 id={`${audience.id}-title`}>{audience.title}</h2>
                    <p>{audience.lede}</p>
                  </div>
                </header>
                {audience.topics.map((topic) => (
                  <div key={topic.title} className="pg-topic" data-faq-group>
                    <h3 className="pg-topic-title">{topic.title}<span>{topic.faqs.length}</span></h3>
                    <div className="pg-qas">
                      {topic.faqs.map((faq) => (
                        <details key={faq.id} id={faq.id} className="pg-qa" data-faq>
                          <summary>
                            <span>{faq.q.replace(/\.$/, '')}</span>
                            <QaIcon />
                          </summary>
                          <div className="pg-qa-body">{faq.a}</div>
                        </details>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            );
          })}
        </div>

        <section className="pg-block" id="install" aria-labelledby="install-title">
          <div className="pg-block-head">
            <p className="pg-kicker">Install</p>
            <h2 id="install-title" className="pg-h2"><Tight>Put it on your home screen.</Tight></h2>
            <p className="pg-body">No app store and nothing heavy to download. It opens full screen with its own icon, straight to your home.</p>
            <InstallAppButton className="pg-btn pg-btn-primary pg-install-btn" label="Install now" />
          </div>
          <div className="pg-install">
            <article className="pg-install-card">
              <header><span aria-hidden="true"><Smartphone size={20} /></span><div><h3>Android</h3><small>Chrome</small></div></header>
              <ol>
                <li>Open the menu (three dots) at the top right.</li>
                <li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
                <li>Tap <strong>Install</strong>.</li>
              </ol>
            </article>
            <article className="pg-install-card">
              <header><span aria-hidden="true"><TabletSmartphone size={20} /></span><div><h3>iPhone</h3><small>Safari</small></div></header>
              <ol>
                <li>Tap the <strong>Share</strong> button.</li>
                <li>Choose <strong>Add to Home Screen</strong>.</li>
                <li>Tap <strong>Add</strong>.</li>
              </ol>
            </article>
            <article className="pg-install-card">
              <header><span aria-hidden="true"><Laptop size={20} /></span><div><h3>Laptop</h3><small>Chrome or Edge</small></div></header>
              <ol>
                <li>Click the install icon at the right of the address bar.</li>
                <li>Click <strong>Install</strong>.</li>
                <li>Find it in your apps or pin it to the taskbar.</li>
              </ol>
            </article>
          </div>
        </section>

        <section className="pg-block" aria-labelledby="contact-title">
          <div className="pg-block-head">
            <p className="pg-kicker">Still stuck?</p>
            <h2 id="contact-title" className="pg-h2"><Tight>The right person, first time.</Tight></h2>
          </div>
          <div className="pg-contact">
            <article>
              <span className="pg-contact-icon" aria-hidden="true"><ListChecks size={20} /></span>
              <h3>A class or an entry</h3>
              <p>The lecturer or class rep who took that attendance. They can add, remove or fix an entry straight away.</p>
            </article>
            <article>
              <span className="pg-contact-icon" aria-hidden="true"><ScanFace size={20} /></span>
              <h3>Your name, matric or setup code</h3>
              <p>Your HOC. They keep your class list and can give you a setup code.</p>
            </article>
            <article>
              <span className="pg-contact-icon" aria-hidden="true"><LifeBuoy size={20} /></span>
              <h3>Your account or your data</h3>
              <p>Your department’s or faculty’s LASUATOS administrator, for example to release an account or delete a face.</p>
            </article>
          </div>
          <div className="pg-foot-links">
            <Link href="/privacy"><ShieldCheck size={17} aria-hidden="true" /> Privacy notice</Link>
            <Link href="/terms"><MessageCircleQuestion size={17} aria-hidden="true" /> Terms of use</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
