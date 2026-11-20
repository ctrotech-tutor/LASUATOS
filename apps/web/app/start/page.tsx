import type { Metadata } from 'next';
import { ArrowRight, CirclePlay, Clock3, Download, QrCode, ScanFace, Smartphone, TriangleAlert, UserRoundPlus } from 'lucide-react';
import Link from 'next/link';
import { GuideVideo } from '../../components/start-video';
import { GuideChapters } from '../../components/start-chapters';
import { StartShare } from '../../components/start-share';
import { GUIDE_MEDIA } from '../../lib/guide-media';
import { Tight } from '../../components/tight';
import '../pages.css';

export const metadata: Metadata = {
  title: 'How to use LASUATOS: the student guide',
  description:
    'A three-minute video for students: open your LASUATOS account with your matric number, register your face, mark attendance in class, and what to do when something goes wrong.',
};

/* Chapter timestamps match the clip cuts in tools/student-guide-video/dist.sh. */
const CHAPTERS = [
  { t: 0, stamp: '0:00', title: 'Open your account with your matric number' },
  { t: 78, stamp: '1:18', title: 'Register your face, once' },
  { t: 98, stamp: '1:38', title: 'Scan the code in class' },
  { t: 131, stamp: '2:11', title: 'What to do when it goes wrong' },
] as const;

const CLIPS = [
  {
    id: 'open-account',
    icon: UserRoundPlus,
    title: 'Opening your account',
    text: 'Matric number, a code to your LASU email, your own password. Your name comes from your class list, so it fills in by itself.',
  },
  {
    id: 'face',
    icon: ScanFace,
    title: 'Registering your face',
    text: 'Three quick photos, once. Face a light, hold at eye level, and turn your head slowly when asked.',
  },
  {
    id: 'mark',
    icon: QrCode,
    title: 'Installing and marking',
    text: 'Add LASUATOS to your home screen once, then scan the code on the projector, look at the camera, done.',
  },
  {
    id: 'problems',
    icon: TriangleAlert,
    title: 'When something goes wrong',
    text: 'A code that won’t scan, a phone that’s dead, a face check that fails. Each has a way through.',
  },
] as const;

export default function StartPage() {
  return (
    <div className="pg">
      <header className="pg-hero pg-hero-center sg-hero-head">
        <div className="pg-wrap">
          <p className="pg-kicker">Student guide</p>
          <h1 className="pg-title"><Tight>Three minutes, then you know LASUATOS.</Tight></h1>
          <p className="pg-lede">
            One short video: open your account, register your face, mark attendance in class.
            Only need one bit? The short parts are below.
          </p>
          <ul className="sg-meta" aria-label="About this guide">
            <li><Clock3 size={15} aria-hidden="true" /> 3 minutes</li>
            <li><Smartphone size={15} aria-hidden="true" /> Any phone</li>
            <li><Download size={15} aria-hidden="true" /> Nothing to install</li>
          </ul>
        </div>
      </header>

      <div className="pg-wrap">
        <section className="sg-hero" aria-label="The full student guide video">
          <div className="sg-hero-video">
            <GuideVideo
              className="sg-video"
              src={GUIDE_MEDIA.master.src}
              poster={GUIDE_MEDIA.master.poster}
              durationLabel={GUIDE_MEDIA.master.durationLabel}
              label="Video: how to use LASUATOS as a student, in about three minutes"
              seekKey="master"
            />
            <p className="sg-note">Nothing downloads until you tap play.</p>
          </div>
          <div className="sg-hero-rail">
            <h2 className="sg-rail-title">In these three minutes</h2>
            <GuideChapters chapters={CHAPTERS} seekKey="master" />
            <div className="pg-start-actions sg-actions">
              <Link className="pg-btn pg-btn-gold" href="/sign-up">Open my account <ArrowRight size={17} aria-hidden="true" /></Link>
              <Link className="pg-btn pg-btn-onDark" href="/help"><CirclePlay size={17} aria-hidden="true" /> Written help</Link>
            </div>
            <StartShare />
          </div>
        </section>

        <section className="pg-block" aria-labelledby="clips-title">
          <div className="pg-block-head">
            <p className="pg-kicker">Short parts</p>
            <h2 id="clips-title" className="pg-h2"><Tight>Only need one bit?</Tight></h2>
            <p className="pg-body">Each part stands on its own — handy to send to a classmate who is stuck on one step.</p>
          </div>
          <div className="sg-clips">
            {CLIPS.map((clip) => {
              const Icon = clip.icon;
              const media = GUIDE_MEDIA[clip.id];
              return (
                <article key={clip.id} className="sg-clip" id={`clip-${clip.id}`}>
                  <GuideVideo
                    className="sg-clip-media"
                    src={media.src}
                    poster={media.poster}
                    durationLabel={media.durationLabel}
                    label={`Video: ${clip.title}`}
                  />
                  <div className="sg-clip-body">
                    <header>
                      <span className="sg-clip-icon" aria-hidden="true"><Icon size={18} /></span>
                      <h3>{clip.title}</h3>
                    </header>
                    <small className="sg-clip-time">{media.durationLabel}</small>
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
              LASUATOS is a website, so there’s nothing to download. Adding it to your home screen
              makes it one tap away in class — you mark attendance from the browser either way.
            </p>
          </div>
          <div className="sg-install">
            <ul className="sg-install-chips" aria-label="Works on">
              <li>Android</li>
              <li>iPhone</li>
              <li>Laptop</li>
            </ul>
            <Link className="pg-btn pg-btn-primary" href="/help#install">How to install it <ArrowRight size={17} aria-hidden="true" /></Link>
          </div>
        </section>
      </div>
    </div>
  );
}
