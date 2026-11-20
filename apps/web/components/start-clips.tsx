// The short parts of the student guide: ONE shared player plus a list of the
// four parts, instead of four separate video cards. Picking a row swaps the
// player's video in and starts it (a real tap, so sound is allowed) — the
// player answers through the same `sg:seek` bridge the chapters use.
// `#clip-<id>` in the URL preselects a part, so a link can point a classmate
// at exactly the step they are stuck on.
'use client';

import { Check, Link2, Play, QrCode, ScanFace, TriangleAlert, UserRoundPlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { GUIDE_MEDIA } from '../lib/guide-media';
import { GuideVideo } from './start-video';

const CLIPS = [
  {
    id: 'open-account',
    tone: 'navy',
    icon: UserRoundPlus,
    title: 'Opening your account',
    text: 'Matric number, a code to your LASU email, your own password. Your name comes from your class list, so it fills in by itself.',
  },
  {
    id: 'face',
    tone: 'green',
    icon: ScanFace,
    title: 'Registering your face',
    text: 'Three quick photos, once. Face a light, hold at eye level, and turn your head slowly when asked.',
  },
  {
    id: 'mark',
    tone: 'gold',
    icon: QrCode,
    title: 'Installing and marking',
    text: 'Add LASUATOS to your home screen once, then scan the code on the projector, look at the camera, done.',
  },
  {
    id: 'problems',
    tone: 'red',
    icon: TriangleAlert,
    title: 'When something goes wrong',
    text: 'A code that won’t scan, a phone that’s dead, a face check that fails. Each has a way through.',
  },
] as const;

export function GuideClips() {
  const [activeId, setActiveId] = useState<string>(CLIPS[0].id);
  const [copied, setCopied] = useState(false);
  const playTimer = useRef<number | undefined>(undefined);

  /* A shared link (#clip-face) opens the page with that part loaded. */
  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.replace('#clip-', '');
      if (CLIPS.some((clip) => clip.id === id)) setActiveId(id);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

  useEffect(() => () => window.clearTimeout(playTimer.current), []);

  useEffect(() => {
    if (!copied) return undefined;
    const t = window.setTimeout(() => setCopied(false), 2200);
    return () => window.clearTimeout(t);
  }, [copied]);

  const pick = (id: string) => {
    setActiveId(id);
    window.history.replaceState(null, '', `#clip-${id}`);
    // The fresh player mounts and attaches its `sg:seek` listener first;
    // on the wide layout it is already in view, so don't scroll the page.
    window.clearTimeout(playTimer.current);
    playTimer.current = window.setTimeout(() => {
      const scroll = !window.matchMedia('(min-width: 1020px)').matches;
      window.dispatchEvent(new CustomEvent('sg:seek', { detail: { key: 'clip', t: 0, scroll } }));
    }, 90);
  };

  const copyLink = async () => {
    const url = `${window.location.origin}/start#clip-${activeId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Older browsers: select a temporary input so the user can copy manually.
      const input = document.createElement('input');
      input.value = url;
      document.body.append(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    setCopied(true);
  };

  const active = CLIPS.find((clip) => clip.id === activeId) ?? CLIPS[0];
  const media = GUIDE_MEDIA[active.id];

  return (
    <div className="sg-deck">
      <div className="sg-deck-player">
        <GuideVideo
          key={active.id}
          className="sg-video"
          src={media.src}
          poster={media.poster}
          durationLabel={media.durationLabel}
          label={`Video: ${active.title}`}
          seekKey="clip"
        />
        <p className="sg-note">Part {CLIPS.indexOf(active) + 1} of {CLIPS.length} — {active.title}</p>
        <button type="button" className="sg-partlink" onClick={copyLink} aria-live="polite">
          {copied ? <Check size={15} aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />}
          {copied ? 'Link copied!' : 'Copy a link to this part'}
        </button>
      </div>
      <ol className="sg-parts" aria-label="The four short parts">
        {CLIPS.map((clip) => {
          const Icon = clip.icon;
          const isActive = clip.id === active.id;
          return (
            <li key={clip.id} id={`clip-${clip.id}`}>
              <button
                type="button"
                className="sg-part"
                data-active={isActive || undefined}
                aria-pressed={isActive}
                onClick={() => pick(clip.id)}
              >
                <span className="sg-part-icon" data-tone={clip.tone} aria-hidden="true"><Icon size={18} /></span>
                <span className="sg-part-text">
                  <strong>{clip.title}</strong>
                  <span>{clip.text}</span>
                </span>
                <span className="sg-part-time">{GUIDE_MEDIA[clip.id].durationLabel}</span>
                <span className="sg-part-play" aria-hidden="true"><Play size={13} fill="currentColor" /></span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
