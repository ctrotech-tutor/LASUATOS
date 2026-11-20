// The student guide video player: the video does not load (let alone play)
// until the visitor taps play, so the 23 MB file costs nothing to people who
// only read the page. The tap is a user gesture, so sound is allowed.
'use client';

import { useRef, useState } from 'react';

export function GuideVideo({ className }: Readonly<{ className?: string }>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  const start = () => {
    const video = videoRef.current;
    if (!video) return;
    video.controls = true;
    setStarted(true);
    void video.play().catch(() => undefined);
  };

  return (
    <div className={className} data-started={started || undefined}>
      <video
        ref={videoRef}
        src="/media/student-guide.mp4"
        poster="/media/student-guide-poster.jpg"
        playsInline
        preload="none"
        aria-label="Video: how to use LASUATOS as a student, in about three minutes"
      />
      {!started && (
        <button type="button" className="sg-cover" onClick={start} aria-label="Play the video with sound">
          <span className="sg-cover-play" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>
          </span>
          <span className="sg-cover-label">Play with sound · 3 min</span>
        </button>
      )}
    </div>
  );
}
