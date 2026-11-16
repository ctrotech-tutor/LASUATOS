'use client';

import { ArrowRight, QrCode } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { createAttendanceSession } from '../../lib/attendance-api';
import { formatClock } from '../../lib/lecture-api';
import { peekResource, primeResource, useResource } from '../../lib/resource';
import { Button, SegmentedControl, Sheet } from '../ds';
import { Select } from '../ui/select';
import { SwitchField } from '../ui/switch';
import { durationLabel } from '../take-attendance/format';
import { loadVenues, rememberCode, SESSIONS_KEY, VENUES_KEY } from './data';
import {
  defaultOffering,
  DURATIONS,
  isLive,
  KINDS,
  kindOf,
  problemText,
  sessionTitle,
  withSession,
  type CourseSession,
  type Duration,
  type Offering,
} from './model';

const SHORT: Record<Duration, string> = { 30: '30m', 60: '1h', 90: '90m', 120: '2h', 180: '3h' };

type Props = Readonly<{
  open: boolean;
  openable: readonly Offering[];
  sessions: readonly CourseSession[];
  preferred: string | null;
  now: number;
  onClose: () => void;
}>;

/** Opening a class: a sheet over the list, so the list stays where it was. */
export function OpenClassSheet({ open, ...rest }: Props) {
  return (
    <Sheet open={open} onClose={rest.onClose} title="Open a class">
      {/* A fresh form each time it opens, with the course the page is showing. */}
      {open ? <OpenClassForm {...rest} /> : null}
    </Sheet>
  );
}

function OpenClassForm({ openable, sessions, preferred, now }: Omit<Props, 'open'>) {
  const router = useRouter();
  const venues = useResource(VENUES_KEY, loadVenues, { maxAge: 300_000 });
  const [courseId, setCourseId] = useState(() => defaultOffering(openable, preferred));
  const course = openable.find((item) => item.courseOfferingId === courseId) ?? null;
  // The title follows the course (its week) until the lecturer types their own.
  const [typedTitle, setTypedTitle] = useState<string | null>(null);
  const [kind, setKind] = useState<(typeof KINDS)[number]>('lecture');
  const title = typedTitle ?? sessionTitle(course, kind, now);
  const [duration, setDuration] = useState<Duration>(60);
  const [venueId, setVenueId] = useState('');
  const [qrOnly, setQrOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const alreadyOpen = course ? sessions.find((item) => item.courseOfferingId === course.courseOfferingId && isLive(item)) ?? null : null;
  const endsAt = now ? formatClock(new Date(now + duration * 60_000)) : '';
  const venueList = venues.data ?? [];
  const venue = venueList.find((item) => item.id === venueId) ?? null;
  const activeKind = kindOf(title);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!course) {
      setError('Choose the course first.');
      return;
    }
    if (!title.trim()) {
      setError('Give the class a name, like “Week 6 lecture”.');
      return;
    }
    setBusy(true);
    try {
      const result = await createAttendanceSession({
        courseOfferingId: course.courseOfferingId,
        venueId: venueId || null,
        title: title.trim(),
        durationMinutes: duration,
        qrOnly,
      });
      rememberCode(result.session.id, { code: result.code, expiresAt: result.session.endsAt });
      // The list shows the class at once when the lecturer comes back to it.
      primeResource(SESSIONS_KEY, withSession(peekResource<readonly CourseSession[]>(SESSIONS_KEY) ?? sessions, result.session));
      router.push(`/lecturer/attendance/${result.session.id}`);
    } catch (caught) {
      setError(problemText(caught, 'The class did not open. Check your connection and try again.'));
      setBusy(false);
    }
  }

  return (
    <form className="tk-form cs-open" onSubmit={(event) => void submit(event)} noValidate>
      <label className="account-field">
        <span>Course</span>
        <Select
          value={courseId}
          onValueChange={(next) => {
            setCourseId(next);
            setError('');
          }}
          placeholder="Choose a course"
          searchable={openable.length > 6}
          options={openable.map((item) => ({
            value: item.courseOfferingId,
            label: item.courseCode,
            description: `${item.courseTitle} · ${item.students.toLocaleString('en-NG')} ${item.students === 1 ? 'student' : 'students'}`,
          }))}
        />
      </label>

      {alreadyOpen ? (
        <p className="tk-note cs-open-note" role="note">
          <span>
            <strong>{alreadyOpen.courseCode} is already open</strong>: {alreadyOpen.title}, until {formatClock(alreadyOpen.endsAt)}.
          </span>
          <Button size="sm" variant="tinted" href={`/lecturer/attendance/${alreadyOpen.id}`} icon={<ArrowRight size={16} aria-hidden="true" />}>Go to it</Button>
        </p>
      ) : null}

      {course && course.students === 0 ? (
        <p className="tk-note is-warning" role="note">
          No student has joined {course.courseCode} yet, so no one can check in. Give them its join code in Course tools first.
        </p>
      ) : null}

      <div className="account-field">
        <label htmlFor="cs-title">Name</label>
        <input
          id="cs-title"
          value={title}
          onChange={(event) => setTypedTitle(event.target.value)}
          maxLength={160}
          autoComplete="off"
          enterKeyHint="go"
        />
        <div className="cs-kinds" role="group" aria-label="Kind of class">
          {KINDS.map((item) => (
            <button
              key={item}
              type="button"
              className={`lx-chip-button${activeKind === item ? ' is-selected' : ''}`}
              aria-pressed={activeKind === item}
              onClick={() => {
                setKind(item);
                setTypedTitle(null);
              }}
            >
              {item.charAt(0).toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="account-field" role="group" aria-labelledby="cs-duration-label">
        <span className="tk-label-row">
          <span id="cs-duration-label">Open for</span>
          {endsAt ? <span className="tk-label-aside">until {endsAt}</span> : null}
        </span>
        <SegmentedControl
          block
          label="Attendance stays open for"
          value={String(duration)}
          onChange={(value) => setDuration(Number(value) as Duration)}
          segments={DURATIONS.map((minutes) => ({
            value: String(minutes),
            label: <><span aria-hidden="true">{SHORT[minutes]}</span><span className="sr-only">{durationLabel(minutes)}</span></>,
          }))}
        />
      </div>

      {venueList.length ? (
        <label className="account-field">
          <span>Venue</span>
          <Select
            value={venueId}
            onValueChange={setVenueId}
            searchable={venueList.length > 8}
            options={[
              { value: '', label: 'No venue', description: 'Students can check in from anywhere' },
              ...venueList.map((item) => ({
                value: item.id,
                label: `${item.code} · ${item.name}`,
                description: [item.buildingName, item.campusName].filter(Boolean).join(', '),
              })),
            ]}
          />
          {venue ? (
            <small>
              {venue.geofenceRadiusMeters
                ? 'Each phone shares its location when the student checks in. Clearly outside readings are refused.'
                : 'This venue’s location is not registered, so it only names the room.'}
            </small>
          ) : null}
        </label>
      ) : null}

      <SwitchField
        checked={qrOnly}
        onCheckedChange={setQrOnly}
        label="QR code only"
        hint="Typed codes are refused, so a code sent to a group chat is no use. Students scan the code in the room."
      />

      {error ? <p className="tk-error" role="alert">{error}</p> : null}
      <Button type="submit" size="lg" block busy={busy} disabled={!openable.length} icon={<QrCode size={20} strokeWidth={2.1} aria-hidden="true" />}>
        {busy ? 'Opening…' : 'Start attendance'}
      </Button>
    </form>
  );
}
