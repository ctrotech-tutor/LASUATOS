import type { Metadata } from 'next';
import { ArrowRight, CirclePlay, QrCode, ScanFace, TriangleAlert, UserRoundPlus } from 'lucide-react';
import Link from 'next/link';
import { GuideVideo } from '../../components/start-video';
import { Tight } from '../../components/tight';
import '../pages.css';

export const metadata: Metadata = {
  title: 'How to use LASUATOS: the student guide',
  description:
    'A three-minute video for students: open your LASUATOS account with your matric number, register your face, mark attendance in class, and what to do when something goes wrong.',
};

const CLIPS = [
  {
    id: 'open-account',
    icon: UserRoundPlus,
    title: 'Opening your account',
    time: '1 min',
    src: '/media/student-guide-open-account.mp4',
    text: 'Matric number, a code to your LASU email, your own password. Your name comes from your class list, so it fills in by itself.',
  },
  {
    id: 'face',
    icon: ScanFace,
    title: 'Registering your face',
    time: '20 sec',
    src: '/media/student-guide-face.mp4',
    text: 'Three quick photos, once. Face a light, hold at eye level, and turn your head slowly when asked.',
  },
  {
    id: 'mark',
    icon: QrCode,
    title: 'Installing and marking',
    time: '35 sec',
    src: '/media/student-guide-mark.mp4',
    text: 'Add LASUATOS to your home screen once, then scan the code on the projector, look at the camera, done.',
  },
  {
    id: 'problems',
    icon: TriangleAlert,
    title: 'When something goes wrong',
    time: '40 sec',
    src: '/media/student-guide-problems.mp4',
    text: 'A code that won’t scan, a phone that’s dead, a face check that fails. Each has a way through.',
  },
] as const;

export default function StartPage() {
  return (
    <div className="pg">
      <header className="pg-hero pg-hero-center">
        <div className="pg-wrap">
          <p className="pg-kicker pg-kicker-light">Student guide</p>
          <h1 className="pg-title"><Tight>Watch: three minutes, then you know LASUATOS.</Tight></h1>
          <p className="pg-lede">
            From opening your account to being marked present in class. Short parts are below if you only need one bit.
          </p>
        </div>
      </header>

      <div className="pg-wrap">
        <section className="sg-hero" aria-label="The full student guide video">
          <GuideVideo className="sg-video" />
          <ol className="sg-chapters" aria-label="What the video covers">
            <li><span>1</span>Open your account with your matric number</li>
            <li><span>2</span>Register your face, once</li>
            <li><span>3</span>Scan the code in class</li>
            <li><span>4</span>What to do when it goes wrong</li>
          </ol>
          <div className="pg-start-actions sg-actions">
            <Link className="pg-btn pg-btn-gold" href="/sign-up">Open my account <ArrowRight size={17} aria-hidden="true" /></Link>
            <Link className="pg-btn pg-btn-onDark" href="/help"><CirclePlay size={17} aria-hidden="true" /> Written help</Link>
          </div>
        </section>

        <section className="pg-block" aria-labelledby="clips-title">
          <div className="pg-block-head">
            <p className="pg-kicker">Short parts</p>
            <h2 id="clips-title" className="pg-h2"><Tight>Only need one bit?</Tight></h2>
            <p className="pg-body">Each part stands on its own. They are also handy to send to a classmate who is stuck on one step.</p>
          </div>
          <div className="sg-clips">
            {CLIPS.map((clip) => {
              const Icon = clip.icon;
              return (
                <article key={clip.id} className="sg-clip">
                  <video
                    src={clip.src}
                    poster={`/media/student-guide-${clip.id}.jpg`}
                    controls
                    playsInline
                    preload="none"
                    aria-label={`Video: ${clip.title}`}
                  />
                  <div className="sg-clip-body">
                    <header>
                      <span className="sg-clip-icon" aria-hidden="true"><Icon size={18} /></span>
                      <h3>{clip.title}</h3>
                    </header>
                    <small className="sg-clip-time">{clip.time}</small>
                    <p>{clip.text}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="pg-block" aria-labelledby="install-title">
          <div className="pg-block-head">
            <p className="pg-kicker">Before your next class</p>
            <h2 id="install-title" className="pg-h2"><Tight>Put it on your home screen.</Tight></h2>
            <p className="pg-body">
              LASUATOS is a website, so there’s nothing to download. Adding it to your home screen makes it one tap away in class:{' '}
              <Link href="/help#install">Android, iPhone or laptop</Link>.
            </p>
            <p className="pg-body">You mark attendance from the browser either way.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
