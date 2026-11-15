'use client';

import type { LectureSessionSummary, LectureVenueOptions } from '@lasuatos/contracts';
import { useEffect, useState } from 'react';
import { failureText, loadLectureVenues, updateLectureSession } from '../../lib/lecture-api';
import { CoursePicker, useCourseCatalog } from '../course-picker';
import { LecturerField } from './lecturer-field';
import { EditDialog } from '../ui/edit-dialog';
import { Select } from '../ui/select';
import { Bone } from '../ui/skeleton';
import { SwitchField } from '../ui/switch';

/** Corrects the course, lecturer and venue chosen when the session was opened. */
export function EditSessionDialog({ session, onClose, onSaved }: Readonly<{
  session: LectureSessionSummary;
  onClose: () => void;
  onSaved: (session: LectureSessionSummary) => void;
}>) {
  const [courseCode, setCourseCode] = useState(session.courseCode);
  const [lecturerName, setLecturerName] = useState(session.lecturerName ?? '');
  const [venueId, setVenueId] = useState(session.venueId ?? '');
  const [requireVenue, setRequireVenue] = useState(session.requireVenue);
  const catalog = useCourseCatalog();
  const [venues, setVenues] = useState<LectureVenueOptions['venues'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void loadLectureVenues(controller.signal).then((result) => setVenues(result.venues)).catch(() => setVenues([]));
    return () => controller.abort();
  }, []);

  const venueList = venues ?? [];
  const venue = venueList.find((item) => item.id === venueId) ?? null;
  // Keep the current venue choosable even if it is no longer in the active list.
  const venueOptions = [
    { value: '', label: 'No venue' },
    ...(session.venueId && !venueList.some((item) => item.id === session.venueId)
      ? [{ value: session.venueId, label: session.venueName ?? 'Current venue' }]
      : []),
    ...venueList.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}`, ...(item.campusName ? { description: item.campusName } : {}) })),
  ];
  const canRequire = venue ? venue.hasBoundary : venueId !== '' && session.requireVenue;

  async function save() {
    const input: Parameters<typeof updateLectureSession>[1] = {};
    const lecturer = lecturerName.trim().replace(/\s+/g, ' ');
    if (courseCode !== session.courseCode) input.courseCode = courseCode;
    if (lecturer !== (session.lecturerName ?? '')) input.lecturerName = lecturer || null;
    const nextVenue = venueId || null;
    const nextRequire = Boolean(nextVenue) && requireVenue && canRequire;
    if (nextVenue !== session.venueId) input.venueId = nextVenue;
    if (nextRequire !== session.requireVenue) input.requireVenue = nextRequire;
    if (Object.keys(input).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    try {
      onSaved(await updateLectureSession(session.id, input));
    } catch (caught) {
      setError(failureText(caught));
      setBusy(false);
    }
  }

  return (
    <EditDialog title="Edit details" busy={busy} error={error} onClose={onClose} onSubmit={save}>
      <div className="tk-edit">
      <CoursePicker
        compact
        state={catalog.state}
        value={courseCode}
        onPick={(course) => setCourseCode(course.code)}
        onCatalogChange={catalog.replace}
        onRetry={catalog.retry}
        current={{ code: session.courseCode, title: session.courseTitle }}
      />
      <LecturerField value={lecturerName} onChange={setLecturerName} placeholder="Pick or type a name" />
      {venues === null ? (
        <div className="sk-form" aria-hidden="true"><Bone width="30%" height={12} /><Bone height={46} /></div>
      ) : venueOptions.length > 1 ? (
        <>
          <label className="account-field">
            <span>Venue</span>
            <Select
              value={venueId}
              onValueChange={(next) => {
                setVenueId(next);
                if (!next) setRequireVenue(false);
                else if (venueList.find((item) => item.id === next)?.hasBoundary) setRequireVenue(true);
              }}
              options={venueOptions}
            />
          </label>
          {venueId ? (
            <SwitchField
              checked={requireVenue && canRequire}
              onCheckedChange={setRequireVenue}
              disabled={!canRequire}
              label="Check they’re in the room"
              hint={canRequire ? 'For students who mark attendance from now on.' : 'This venue’s location isn’t registered yet.'}
            />
          ) : null}
        </>
      ) : null}
      </div>
    </EditDialog>
  );
}
