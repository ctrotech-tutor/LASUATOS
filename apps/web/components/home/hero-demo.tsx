'use client';

import { Check, Clock3, LocateFixed, MapPin, ScanFace, ScanLine } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MockQr } from './mock-qr';

const STUDENTS = [
  { name: 'OKAFOR Chidinma', matric: '220591034' },
  { name: 'ADEYEMI Tolulope', matric: '220591118' },
  { name: 'BELLO Abdulrahman', matric: '220591007' },
  { name: 'OGUNLEYE Damilare', matric: '220591152' },
  { name: 'EZE Chiamaka', matric: '220591086' },
  { name: 'ALABI Mariam', matric: '220591041' },
  { name: 'ADEBAYO Kehinde', matric: '220591129' },
  { name: 'NWOSU Emeka', matric: '220591063' },
] as const;

const STAGES = ['scan', 'face', 'place', 'done'] as const;
const STEP_TICKS = 5; // 2.5 s per stage at 500 ms a tick
const CYCLE_TICKS = STEP_TICKS * STAGES.length;
const BASE_PRESENT = 131;
const CLASS_SIZE = 160;
const MINUTE_ZERO = 2; // 08:02 for the first student

function student(index: number) {
  return STUDENTS[((index % STUDENTS.length) + STUDENTS.length) % STUDENTS.length]!;
}

function initials(name: string) {
  const [surname = '', first = ''] = name.split(' ');
  return `${first.charAt(0)}${surname.charAt(0)}`;
}

function timeFor(index: number) {
  const minute = MINUTE_ZERO + Math.floor(Math.max(index, 0) / 3);
  return `08:${String(minute % 60).padStart(2, '0')}`;
}

function codeFor(seed: number) {
  const alphabet = 'ACDEFGHJKMNPQRTUVWXY3479';
  let value = (seed * 7919 + 104729) >>> 0;
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[value % alphabet.length];
    value = Math.floor(value / alphabet.length) + (i + 3) * 131;
  }
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/**
 * The hero illustration, alive: the projector QR keeps changing, a student
 * goes through scan → face → location → present, and the register fills in.
 * Starts on "present" so the first paint (and reduced motion) tells the story.
 */
export function HeroDemo() {
  const [tick, setTick] = useState(CYCLE_TICKS - 1);
  const stageRef = useRef<HTMLDivElement>(null);

  // Kept cheap for low-end phones: the clock only re-renders when something on screen changes
  // (the countdown each second, the student's step every 2.5 s), and while the stage is off screen
  // the clock stops and its CSS animations are paused too.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const stage = stageRef.current;
    let visible = true;
    let current = CYCLE_TICKS - 1;
    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      stage?.classList.toggle('is-paused', !visible);
    });
    if (stage) observer.observe(stage);
    const timer = window.setInterval(() => {
      if (!visible || document.hidden) return;
      current += 1;
      if (current % 2 === 0 || current % STEP_TICKS === 0) setTick(current);
    }, 500);
    return () => { window.clearInterval(timer); observer.disconnect(); };
  }, []);

  const cycle = Math.floor(tick / CYCLE_TICKS);
  const stage = STAGES[Math.floor((tick % CYCLE_TICKS) / STEP_TICKS)]!;
  const marked = stage === 'done';
  const current = student(cycle);
  const latest = marked ? cycle : cycle - 1;
  const present = Math.min(CLASS_SIZE, BASE_PRESENT + latest + 1);
  const rows = [0, 1, 2].map((offset) => ({ index: latest - offset, ...student(latest - offset) }));

  const seconds = Math.floor(tick / 2) + 21;
  const remaining = 30 - (seconds % 30);
  const qrSeed = Math.floor(seconds / 30);

  return (
    <div className="hp-stage" ref={stageRef} aria-hidden="true">
      {/* Projector */}
      <div className="hp-projector">
        <div className="hp-projector-bar">
          <span className="hp-live"><i /> Live</span>
          <span className="hp-projector-course">MEE 301 · Engineering Thermodynamics</span>
          <div className="hp-ring-row">
            <svg className="hp-ring" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15.5" className="hp-ring-track" />
              <circle cx="18" cy="18" r="15.5" className="hp-ring-fill" style={{ strokeDashoffset: `${97.4 * (1 - remaining / 30)}` }} />
            </svg>
            <span>New code in <b>{remaining}s</b></span>
          </div>
        </div>
        <div className="hp-projector-body">
          <div className="hp-projector-qr">
            <MockQr seed={qrSeed} className="hp-qr" key={qrSeed} />
          </div>
          <div className="hp-projector-side">
            <p className="hp-projector-title">Scan to mark attendance</p>
            <p className="hp-projector-sub">Lecture Theatre 2 · 08:00–10:00</p>
            <p className="hp-projector-code-label">Or type the code</p>
            <p className="hp-projector-code" key={`c${qrSeed}`}>{codeFor(qrSeed)}</p>
          </div>
        </div>
      </div>

      {/* Live register */}
      <div className="hp-register">
        <div className="hp-register-head">
          <span className="hp-live is-green"><i /> Live register</span>
          <span className="hp-register-time"><Clock3 size={11} /> {timeFor(latest)}</span>
        </div>
        <p className="hp-register-count"><b>{present}</b> of {CLASS_SIZE} present</p>
        <div className="hp-register-bar"><span style={{ transform: `scaleX(${present / CLASS_SIZE})` }} /></div>
        <ul className="hp-register-list">
          {rows.map((row, position) => (
            <li key={row.index} className={position === 0 ? 'is-new' : undefined}>
              <span className="hp-avatar">{initials(row.name)}</span>
              <span className="hp-register-who">
                <b>{row.name}</b>
                <small>{row.matric}</small>
              </span>
              <span className="hp-register-checks">
                <ScanFace size={11} />
                <MapPin size={11} />
              </span>
              <span className="hp-register-at">{timeFor(row.index)}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Student phone */}
      <div className="hp-phone">
        <div className="hp-phone-notch" />
        <div className="hp-phone-steps">
          {STAGES.map((name, index) => (
            <span key={name} className={STAGES.indexOf(stage) >= index ? 'is-on' : undefined} />
          ))}
        </div>
        <div className={`hp-phone-screen is-${stage}`} key={`${cycle}-${stage}`}>
          {stage === 'scan' ? (
            <div className="hp-scan">
              <div className="hp-scan-view">
                <MockQr seed={qrSeed} className="hp-scan-qr" />
                <span className="hp-scan-line" />
                <i className="c1" /><i className="c2" /><i className="c3" /><i className="c4" />
              </div>
              <p><ScanLine size={13} /> Scanning the code…</p>
            </div>
          ) : null}
          {stage === 'face' ? (
            <div className="hp-face">
              <div className="hp-face-oval">
                <svg viewBox="0 0 100 120" className="hp-face-art">
                  <ellipse cx="50" cy="52" rx="24" ry="30" />
                  <path d="M18 120c3-22 16-32 32-32s29 10 32 32" />
                </svg>
                <span className="hp-sweep"><i><b /></i><i><b /></i></span>
              </div>
              <p className="hp-face-title">Turn slightly left</p>
              <p className="hp-face-sub">Checking it’s really you</p>
            </div>
          ) : null}
          {stage === 'place' ? (
            <div className="hp-place">
              <div className="hp-map">
                <span className="hp-map-venue" />
                <span className="hp-map-accuracy" />
                <MapPin className="hp-map-pin" size={22} />
              </div>
              <p className="hp-place-title"><LocateFixed size={12} /> Inside Lecture Theatre 2</p>
              <p className="hp-place-sub">Location confirmed accurate to ± 9 m</p>
            </div>
          ) : null}
          {stage === 'done' ? (
            <div className="hp-done">
              <span className="hp-done-check"><Check size={26} strokeWidth={3} /></span>
              <p className="hp-done-title">You’re marked present</p>
              <p className="hp-done-name">{current.name}</p>
              <p className="hp-done-meta">{current.matric} · {timeFor(cycle)}</p>
              <p className="hp-done-course">MEE 301 · Lecture Theatre 2</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
