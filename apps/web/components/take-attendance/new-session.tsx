'use client';

import type { LectureCapabilities, LectureCatalogCourse, LectureQrMode, LectureSessionDetail, LectureVenueOptions } from '@lasuatos/contracts';
import { AlertTriangle, MonitorPlay, Printer, QrCode } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { useCurrentAccount } from '../../lib/current-account';
import { createLectureSession, failureText, formatClock, loadLectureVenues } from '../../lib/lecture-api';
import { primeResource, staleResources } from '../../lib/resource';
import { CoursePicker, recentLecturerFor, useCourseCatalog } from '../course-picker';
import { Button, SegmentedControl, Sheet } from '../ds';
import { Select } from '../ui/select';
import { SwitchField } from '../ui/switch';
import { durationLabel } from './format';
import { useClock } from './hooks';

/** How long attendance stays open. A class that runs over adds 15 minutes from the session. */
const DURATIONS = [15, 30, 60, 120, 180] as const;
const SHORT: Record<(typeof DURATIONS)[number], string> = { 15: '15m', 30: '30m', 60: '1h', 120: '2h', 180: '3h' };

export const sessionKey = (id: string) => `take:session:${id}`;

/** Starting a session: a sheet over the list, so the list stays where it was. */
export function NewSessionSheet({ open, onClose, capabilities }: Readonly<{
  open: boolean;
  onClose: () => void;
  capabilities: LectureCapabilities;
}>) {
  return (
    <Sheet open={open} onClose={onClose} title="New session">
      <NewSessionForm capabilities={capabilities} />
    </Sheet>
  );
}

function NewSessionForm({ capabilities }: Readonly<{ capabilities: LectureCapabilities }>) {
  const router = useRouter();
  const account = useCurrentAccount();
  const catalog = useCourseCatalog();
  const isLecturer = capabilities.role === 'lecturer';
  const ownName = isLecturer && account ? account.displayName : '';
  const [courseCode, setCourseCode] = useState('');
  // null: a lecturer's own name. Filled in per course until they type their own; then left alone.
  const [lecturer, setLecturer] = useState<string | null>(null);
  const [typed, setTyped] = useState(false);
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]>(60);
  const [qrMode, setQrMode] = useState<LectureQrMode>('dynamic');
  const [venueId, setVenueId] = useState('');
  const [requireVenue, setRequireVenue] = useState(false);
  const [venues, setVenues] = useState<LectureVenueOptions['venues']>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const now = useClock('fifteen');

  useEffect(() => {
    const controller = new AbortController();
    void loadLectureVenues(controller.signal).then((result) => setVenues(result.venues)).catch(() => undefined);
    return () => controller.abort();
  }, []);

  const lecturerName = lecturer ?? ownName;
  const venue = venues.find((item) => item.id === venueId) ?? null;
  const roomChecked = Boolean(venue?.hasBoundary && requireVenue);
  const endsAt = now ? formatClock(new Date(now + duration * 60_000)) : '';

  function pickCourse(course: LectureCatalogCourse) {
    setCourseCode(course.code);
    setError('');
    if (typed || isLecturer || catalog.state.kind !== 'ready') return;
    // Class reps and administrators: the lecturer they named last time for this course.
    setLecturer(recentLecturerFor(catalog.state.catalog, course.code) ?? '');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!courseCode) {
      setError('Choose the course first.');
      return;
    }
    setBusy(true);
    try {
      const session = await createLectureSession({
        courseCode,
        ...(lecturerName.trim() ? { lecturerName: lecturerName.trim() } : {}),
        durationMinutes: duration,
        qrMode,
        ...(venueId ? { venueId, requireVenue: roomChecked } : {}),
      });
      // The session page opens at once with the QR code; its list fills in as students arrive.
      const detail: LectureSessionDetail = { session, attendees: [], canManage: true, helpRequests: [] };
      primeResource(sessionKey(session.id), detail);
      staleResources('take:sessions:');
      staleResources('admin:');
      router.push(`/sessions/${session.id}`);
    } catch (caught) {
      setError(failureText(caught));
      setBusy(false);
    }
  }

  return (
    <form className="tk-form" onSubmit={(event) => void submit(event)} noValidate>
      <CoursePicker
        compact
        state={catalog.state}
        value={courseCode}
        onPick={pickCourse}
        onCatalogChange={catalog.replace}
        onRetry={catalog.retry}
      />

      <label className="account-field">
        <span>Lecturer</span>
        <input
          value={lecturerName}
          onChange={(event) => {
            setLecturer(event.target.value);
            setTyped(true);
          }}
          placeholder={isLecturer ? 'Your name' : 'Optional, e.g. Dr. Adeyemi'}
          autoComplete="off"
          autoCapitalize="words"
          maxLength={160}
        />
      </label>

      <div className="account-field" role="group" aria-labelledby="tk-duration-label">
        <span className="tk-label-row">
          <span id="tk-duration-label">Open for</span>
          {endsAt ? <span className="tk-label-aside">until {endsAt}</span> : null}
        </span>
        <SegmentedControl
          block
          label="Attendance stays open for"
          value={String(duration)}
          onChange={(value) => setDuration(Number(value) as (typeof DURATIONS)[number])}
          segments={DURATIONS.map((minutes) => ({
            value: String(minutes),
            label: <><span aria-hidden="true">{SHORT[minutes]}</span><span className="sr-only">{durationLabel(minutes)}</span></>,
          }))}
        />
      </div>

      <div className="account-field" role="group" aria-labelledby="tk-qr-label">
        <span id="tk-qr-label">QR code</span>
        <SegmentedControl
          block
          label="QR code"
          value={qrMode}
          onChange={setQrMode}
          segments={[
            { value: 'dynamic', label: 'On a screen', icon: <MonitorPlay size={16} strokeWidth={2.1} aria-hidden="true" /> },
            { value: 'static', label: 'Poster', icon: <Printer size={16} strokeWidth={2.1} aria-hidden="true" /> },
          ]}
        />
        <small>{qrMode === 'dynamic' ? 'Changes every 30 seconds, so a photo of it soon stops working.' : 'One fixed code to print or download.'}</small>
      </div>

      {venues.length > 0 ? (
        <div className="tk-venue">
          <label className="account-field">
            <span>Venue</span>
            <Select
              value={venueId}
              onValueChange={(next) => {
                setVenueId(next);
                // Checking the room is the point of picking a venue: on whenever it can be.
                setRequireVenue(Boolean(venues.find((item) => item.id === next)?.hasBoundary));
              }}
              options={[
                { value: '', label: 'No venue' },
                ...venues.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}`, ...(item.campusName ? { description: item.campusName } : {}) })),
              ]}
            />
          </label>
          {venue ? (
            <SwitchField
              checked={roomChecked}
              onCheckedChange={setRequireVenue}
              disabled={!venue.hasBoundary}
              label="Check they’re in the room"
              hint={venue.hasBoundary ? undefined : 'This venue’s location isn’t registered yet.'}
            />
          ) : null}
        </div>
      ) : null}

      {qrMode === 'static' && !roomChecked ? (
        <p className="tk-note is-warning" role="note">
          <AlertTriangle size={16} strokeWidth={2.1} aria-hidden="true" />
          A poster works from anywhere unless the room is checked.
        </p>
      ) : null}

      {error ? <p className="tk-error" role="alert">{error}</p> : null}
      <Button type="submit" size="lg" block busy={busy} icon={<QrCode size={20} strokeWidth={2.1} aria-hidden="true" />}>
        {busy ? 'Starting…' : 'Start attendance'}
      </Button>
    </form>
  );
}
