// Chapter list for the master guide video: each row jumps the video to that
// moment and starts it. Pure client bridge — the player listens for `sg:seek`.
'use client';

import { Play } from 'lucide-react';

export type Chapter = Readonly<{ t: number; stamp: string; title: string }>;

export function GuideChapters({ chapters, seekKey }: Readonly<{ chapters: readonly Chapter[]; seekKey: string }>) {
  const jump = (t: number) => {
    window.dispatchEvent(new CustomEvent('sg:seek', { detail: { key: seekKey, t } }));
  };

  return (
    <ol className="sg-chapters" aria-label="Jump to a moment in the full video">
      {chapters.map((chapter, i) => (
        <li key={chapter.stamp}>
          <button type="button" onClick={() => jump(chapter.t)}>
            <span className="sg-ch-num" aria-hidden="true">{i + 1}</span>
            <span className="sg-ch-title">{chapter.title}</span>
            <span className="sg-ch-stamp">{chapter.stamp}</span>
            <Play size={15} aria-hidden="true" className="sg-ch-play" />
          </button>
        </li>
      ))}
    </ol>
  );
}
