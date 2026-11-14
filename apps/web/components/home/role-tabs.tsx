'use client';

import { ArrowRight, Check, FileSpreadsheet, GraduationCap, Presentation, ShieldCheck, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

type Role = {
  readonly id: string;
  readonly tab: string;
  readonly icon: typeof GraduationCap;
  readonly title: string;
  readonly lede: string;
  readonly points: readonly string[];
  readonly cta: { readonly href: string; readonly label: string };
  readonly visual: ReactNode;
};

function StudentVisual() {
  const courses = [
    { code: 'MEE 301', title: 'Engineering Thermodynamics', value: 92 },
    { code: 'MEE 305', title: 'Strength of Materials', value: 84 },
    { code: 'GNS 301', title: 'Use of English III', value: 71 },
  ];
  return (
    <div className="hp-mock">
      <div className="hp-mock-head"><b>My attendance</b><span>Harmattan semester</span></div>
      <ul className="hp-mock-courses">
        {courses.map((course) => (
          <li key={course.code}>
            <span className="hp-mock-course"><b>{course.code}</b><small>{course.title}</small></span>
            <span className="hp-mock-meter"><i style={{ width: `${course.value}%` }} className={course.value < 75 ? 'is-low' : undefined} /></span>
            <span className={`hp-mock-pct${course.value < 75 ? ' is-low' : ''}`}>{course.value}%</span>
          </li>
        ))}
      </ul>
      <p className="hp-mock-foot"><Check size={12} /> Last check-in: MEE 301, today 08:04</p>
    </div>
  );
}

function LecturerVisual() {
  const rows = [
    ['ADEYEMI Tolulope', '08:01', 'ok'],
    ['BELLO Abdulrahman', '08:02', 'ok'],
    ['EZE Chiamaka', '08:03', 'help'],
    ['ALABI Mariam', '08:03', 'ok'],
  ] as const;
  return (
    <div className="hp-mock">
      <div className="hp-mock-head"><b>MEE 301 · Today</b><span className="hp-mock-pill">148 / 160</span></div>
      <ul className="hp-mock-rows">
        {rows.map(([name, time, state]) => (
          <li key={name}>
            <span className="hp-avatar">{name.split(' ')[1]?.charAt(0)}{name.charAt(0)}</span>
            <b>{name}</b>
            {state === 'help' ? <span className="hp-mock-tag is-amber">Added after help</span> : <span className="hp-mock-tag">Face ✓ · ± 8 m</span>}
            <small>{time}</small>
          </li>
        ))}
      </ul>
      <div className="hp-mock-actions"><span><FileSpreadsheet size={12} /> Excel / CSV</span><span>Print register</span></div>
    </div>
  );
}

function RepVisual() {
  const rows = [
    ['220591034', 'OKAFOR Chidinma', 'Ready', 'green'],
    ['220591118', 'ADEYEMI Tolulope', 'Ready', 'green'],
    ['220591152', 'OGUNLEYE Damilare', 'Email confirmed', 'blue'],
    ['220591063', 'NWOSU Emeka', 'Not joined', 'grey'],
  ] as const;
  return (
    <div className="hp-mock">
      <div className="hp-mock-head"><b>Class list · 2022 set</b><span>Mechanical Engineering</span></div>
      <div className="hp-mock-drop"><FileSpreadsheet size={14} /> class-list-2022.xlsx <small>158 students checked · no problems</small></div>
      <ul className="hp-mock-rows">
        {rows.map(([matric, name, stage, tone]) => (
          <li key={matric}>
            <small className="hp-mock-matric">{matric}</small>
            <b>{name}</b>
            <span className={`hp-mock-stage is-${tone}`}>{stage}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AdminVisual() {
  const bars = [
    ['100', 88], ['200', 81], ['300', 76], ['400', 69], ['500', 73],
  ] as const;
  return (
    <div className="hp-mock">
      <div className="hp-mock-head"><b>Attendance by level</b><span>This semester</span></div>
      <div className="hp-mock-chart">
        {bars.map(([level, value]) => (
          <span key={level} className="hp-mock-col">
            <small>{value}%</small>
            <i style={{ height: `${value}%` }} />
            <b>{level}L</b>
          </span>
        ))}
      </div>
      <div className="hp-mock-actions"><span><ShieldCheck size={12} /> Audit log</span><span>Venues</span><span>Staff</span></div>
    </div>
  );
}

const ROLES: readonly Role[] = [
  {
    id: 'students',
    tab: 'Students',
    icon: GraduationCap,
    title: 'Open your account once. Then just scan.',
    lede: 'Your HOC has put your class on LASUATOS. Type your matric number, confirm your LASU email and register your face.',
    points: [
      'Mark attendance with a scan or the code on the screen',
      'See your attendance for every course, as it happens',
      'Face check failing? Ask for help and get added on the spot',
    ],
    cta: { href: '/sign-up', label: 'Open your student account' },
    visual: <StudentVisual />,
  },
  {
    id: 'lecturers',
    tab: 'Lecturers',
    icon: Presentation,
    title: 'Your register, filled in while you teach.',
    lede: 'Pick the course, choose how long attendance stays open, and put the code up. The list fills itself in.',
    points: [
      'A changing QR code for the projector, or a poster to print',
      'Every check-in shows the face check and the distance',
      'Registers with percentages for exam eligibility, ready for Excel',
    ],
    cta: { href: '/sessions', label: 'Take attendance' },
    visual: <LecturerVisual />,
  },
  {
    id: 'reps',
    tab: 'Class reps',
    icon: UsersRound,
    title: 'HOCs keep their class organised.',
    lede: 'Upload the class list you already have, from Excel or WhatsApp. Students open their accounts from it.',
    points: [
      'See who has joined, confirmed their email and registered a face',
      'Run attendance when the lecturer asks you to',
      'Give a one-time setup code to a student who is stuck',
    ],
    cta: { href: '/sign-in', label: 'Sign in as a class rep' },
    visual: <RepVisual />,
  },
  {
    id: 'admins',
    tab: 'Admins',
    icon: ShieldCheck,
    title: 'The whole picture, for the whole faculty.',
    lede: 'Invite staff, appoint class reps, map venues and follow attendance across departments and levels.',
    points: [
      'Attendance by department, level and course',
      'Venues on the map, so location checks are accurate',
      'A complete audit trail, and face data deleted on schedule',
    ],
    cta: { href: '/admin', label: 'Open administration' },
    visual: <AdminVisual />,
  },
];

export function RoleTabs() {
  const [active, setActive] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const baseId = useId();
  const role = ROLES[active]!;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let next = active;
    if (event.key in moves) next = (active + moves[event.key]! + ROLES.length) % ROLES.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = ROLES.length - 1;
    else return;
    event.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  }

  return (
    <div className="hp-roles">
      <div className="hp-tabs" role="tablist" aria-label="Who LASUATOS is for" onKeyDown={onKeyDown} style={{ '--active': active } as CSSProperties}>
        <span className="hp-tabs-indicator" aria-hidden="true" />
        {ROLES.map(({ id, tab, icon: Icon }, index) => (
          <button
            key={id}
            ref={(node) => { tabs.current[index] = node; }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${id}`}
            aria-selected={index === active}
            aria-controls={`${baseId}-panel`}
            tabIndex={index === active ? 0 : -1}
            className={index === active ? 'is-active' : undefined}
            onClick={() => setActive(index)}
          >
            <Icon size={16} aria-hidden="true" /> <span>{tab}</span>
          </button>
        ))}
      </div>
      <div className="hp-role-panel" role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${role.id}`} key={role.id}>
        <div className="hp-role-copy">
          <h3>{role.title}</h3>
          <p>{role.lede}</p>
          <ul>
            {role.points.map((point) => (
              <li key={point}><span><Check size={13} strokeWidth={2.6} aria-hidden="true" /></span>{point}</li>
            ))}
          </ul>
          <Link className="hp-link-button" href={role.cta.href}>{role.cta.label} <ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
        <div className="hp-role-visual" aria-hidden="true">{role.visual}</div>
      </div>
    </div>
  );
}
