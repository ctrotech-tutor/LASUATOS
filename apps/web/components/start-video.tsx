// The student guide video player: a fully custom player (seek bar, time, volume,
// fullscreen, keyboard shortcuts) that costs nothing to load until the visitor
// taps play — preload="none" keeps the 23 MB file off the wire for people who
// only read the page. The first tap is a user gesture, so sound is allowed.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Props = Readonly<{
  src: string;
  poster: string;
  label: string;
  durationLabel: string;
  className?: string;
  /** When set, the player answers `sg:seek` window events ({key, t}) by jumping to t and playing. */
  seekKey?: string;
}>;

function fmt(t: number): string {
  if (!Number.isFinite(t)) return '0:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function GuideVideo({ src, poster, label, durationLabel, className, seekKey }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const seekRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const flashTimer = useRef<number | undefined>(undefined);

  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [controlsOn, setControlsOn] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubT, setScrubT] = useState(0);
  const [flash, setFlash] = useState<'play' | 'pause' | null>(null);
  const scrubbingRef = useRef(false); // pointer handlers must not depend on re-render timing

  const video = () => videoRef.current;

  /* Auto-hide the controls while playing; always show when paused. */
  const pokeControls = useCallback(() => {
    setControlsOn(true);
    window.clearTimeout(hideTimer.current);
    const v = video();
    if (v && !v.paused) {
      hideTimer.current = window.setTimeout(() => setControlsOn(false), 2300);
    }
  }, []);

  const pulseFlash = useCallback((kind: 'play' | 'pause') => {
    setFlash(kind);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 520);
  }, []);

  const togglePlay = useCallback(() => {
    const v = video();
    if (!v || failed) return;
    if (v.paused) {
      setStarted(true);
      pulseFlash('play');
      void v.play().catch(() => setFailed(true));
    } else {
      pulseFlash('pause');
      v.pause();
    }
  }, [failed, pulseFlash]);

  const toggleMute = useCallback(() => {
    const v = video();
    if (!v) return;
    v.muted = !v.muted;
  }, []);

  const toggleFullscreen = useCallback(() => {
    const wrap = wrapRef.current;
    const v = video();
    if (!wrap || !v) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else if (wrap.requestFullscreen) {
      void wrap.requestFullscreen().catch(() => {
        // iPhone Safari: only the video element itself can go fullscreen.
        (v as unknown as { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen?.();
      });
    } else {
      (v as unknown as { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen?.();
    }
  }, []);

  const retry = useCallback(() => {
    const v = video();
    if (!v) return;
    setFailed(false);
    v.load();
    setStarted(true);
    void v.play().catch(() => setFailed(true));
  }, []);

  /* Seek helpers */
  const seekFromClientX = useCallback((clientX: number): number => {
    const bar = seekRef.current;
    const v = video();
    if (!bar || !v || !Number.isFinite(v.duration)) return 0;
    const rect = bar.getBoundingClientRect();
    return clamp01((clientX - rect.left) / rect.width) * v.duration;
  }, []);

  const onSeekPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!started) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubbingRef.current = true;
    setScrubbing(true);
    setScrubT(seekFromClientX(e.clientX));
  };
  const onSeekPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scrubbingRef.current) setScrubT(seekFromClientX(e.clientX));
  };
  const onSeekPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const v = video();
    if (!v || !scrubbingRef.current) return;
    scrubbingRef.current = false;
    const t = seekFromClientX(e.clientX);
    v.currentTime = t;
    setTime(t);
    setScrubbing(false);
  };

  const onWrapKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const v = video();
    if (!v || !started) return;
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); v.currentTime = Math.min(v.duration || 0, v.currentTime + 5); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 5); }
    else if (e.key === 'm') { toggleMute(); }
    else if (e.key === 'f') { toggleFullscreen(); }
  };

  /* Smooth progress while playing (timeupdate alone ticks too coarsely). */
  useEffect(() => {
    if (!playing || scrubbing) return undefined;
    let raf = 0;
    const step = () => {
      const v = video();
      if (v) setTime(v.currentTime);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, scrubbing]);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      window.clearTimeout(hideTimer.current);
      window.clearTimeout(flashTimer.current);
    };
  }, []);

  /* Chapter buttons elsewhere on the page jump this video to a timestamp. */
  useEffect(() => {
    if (!seekKey) return;
    const onSeek = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; t?: number; scroll?: boolean }>).detail;
      if (!detail || detail.key !== seekKey || typeof detail.t !== 'number') return;
      const v = video();
      if (!v || failed) return;
      setStarted(true);
      setFailed(false);
      v.currentTime = detail.t;
      setTime(detail.t);
      void v.play().catch(() => setFailed(true));
      if (detail.scroll !== false) wrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    window.addEventListener('sg:seek', onSeek);
    return () => window.removeEventListener('sg:seek', onSeek);
  }, [seekKey, failed]);

  const shownTime = scrubbing ? scrubT : time;
  const frac = duration > 0 ? clamp01(shownTime / duration) : 0;
  const bufFrac = duration > 0 ? clamp01(buffered / duration) : 0;

  return (
    <div
      ref={wrapRef}
      className={className}
      data-sg-player
      data-started={started || undefined}
      data-playing={playing || undefined}
      data-controls={controlsOn ? 'on' : 'off'}
      tabIndex={0}
      role="group"
      aria-label={label}
      onKeyDown={onWrapKeyDown}
      onPointerMove={pokeControls}
      onPointerDown={pokeControls}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        playsInline
        preload="none"
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onPlay={() => { setPlaying(true); pokeControls(); }}
        onPause={() => { setPlaying(false); setControlsOn(true); window.clearTimeout(hideTimer.current); }}
        onEnded={() => { setPlaying(false); setControlsOn(true); }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => { if (!playing) setTime(e.currentTarget.currentTime); }}
        onProgress={(e) => {
          const v = e.currentTarget;
          if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onError={() => { if (started) setFailed(true); }}
        onVolumeChange={(e) => { setMuted(e.currentTarget.muted); setVolume(e.currentTarget.volume); }}
      />

      {!started && !failed && (
        <button type="button" className="sg-cover" onClick={togglePlay} aria-label={`Play: ${label}`}>
          <span className="sg-cover-play" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>
          </span>
          <span className="sg-cover-label">Play with sound · {durationLabel}</span>
        </button>
      )}

      {flash && (
        <span className="sg-flash" aria-hidden="true">
          {flash === 'play'
            ? <svg viewBox="0 0 24 24" width="34" height="34" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>
            : <svg viewBox="0 0 24 24" width="34" height="34" fill="currentColor"><path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z" /></svg>}
        </span>
      )}

      {waiting && started && !failed && <span className="sg-spin" aria-hidden="true" />}

      {failed && (
        <div className="sg-err">
          <p>The video couldn’t load. Check your connection and try again.</p>
          <button type="button" className="sg-err-btn" onClick={retry}>Retry</button>
        </div>
      )}

      {started && !failed && (
        <div className="sg-ui">
          <div
            ref={seekRef}
            className="sg-bar"
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(shownTime)}
            aria-valuetext={`${fmt(shownTime)} of ${fmt(duration)}`}
            tabIndex={-1}
            onPointerDown={onSeekPointerDown}
            onPointerMove={onSeekPointerMove}
            onPointerUp={onSeekPointerUp}
          >
            <span className="sg-buf" style={{ transform: `scaleX(${bufFrac})` }} />
            <span className="sg-fill" style={{ transform: `scaleX(${frac})` }} />
            <span className="sg-knob" style={{ left: `${frac * 100}%` }} />
          </div>
          <div className="sg-row">
            <button type="button" className="sg-btn" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
              {playing
                ? <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z" /></svg>
                : <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>}
            </button>
            <button type="button" className="sg-btn" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
              {muted || volume === 0
                ? <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M4 9v6h4l5 4V5L8 9H4zm14.6 3 2.2-2.2-1.4-1.4-2.2 2.2-2.2-2.2-1.4 1.4 2.2 2.2-2.2 2.2 1.4 1.4 2.2-2.2 2.2 2.2 1.4-1.4-2.2-2.2z" /></svg>
                : <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a3.5 3.5 0 0 0-2-3.15v6.3a3.5 3.5 0 0 0 2-3.15zm-2-7.6v2.1a5.5 5.5 0 0 1 0 7.4v2.1a7.5 7.5 0 0 0 0-11.6z" /></svg>}
            </button>
            <input
              className="sg-vol"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              aria-label="Volume"
              onChange={(e) => {
                const v = video();
                if (!v) return;
                v.volume = Number(e.target.value);
                v.muted = Number(e.target.value) === 0;
              }}
            />
            <span className="sg-time">{fmt(shownTime)} <em>/</em> {fmt(duration)}</span>
            <span className="sg-grow" />
            <button type="button" className="sg-btn" onClick={toggleFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {isFullscreen
                ? <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm14 0h-3v3h-2v-5h5v2zM8 8H5V6h3V3h2v5H8zm11 0V3h2v3h3v2h-5V8z"/></svg>
                : <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M4 9V4h5v2H6v3H4v5zm16 0V4h-5v2h3v3h2V4zM6 15v3h3v2H4v-5h2zm12 3v-3h2v5h-5v-2h3z"/></svg>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
