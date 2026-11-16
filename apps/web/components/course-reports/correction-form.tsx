'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { applyAttendanceCorrection } from '../../lib/attendance-api';
import { haptic } from '../../lib/use-live';
import { CORRECTION_REASONS as REASONS, reasonProblem } from '../course-sessions/model';
import { Button } from '../ds';
import { useFeedback } from '../feedback';
import { problemText, type Correction } from './model';

/**
 * One correction to one student's mark in one class, with the reason it needs. The reason is
 * kept with the record for good; the student sees the change in My attendance.
 */
export function CorrectionForm({ sessionId, studentId, studentName, action, onCancel, onDone }: Readonly<{
  sessionId: string;
  studentId: string;
  studentName: string;
  action: Correction;
  onCancel: () => void;
  onDone: () => void;
}>) {
  const feedback = useFeedback();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const problem = reasonProblem(reason);
  useEffect(() => { field.current?.focus({ preventScroll: true }); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await applyAttendanceCorrection(sessionId, { studentId, action, reason: reason.trim() });
      haptic(14);
      feedback.toast(result.status === 'unchanged'
        ? `No change: ${studentName} was already ${action === 'revoke' ? 'off' : 'on'} that list.`
        : action === 'revoke' ? `${studentName} no longer counts as present for that class.` : `${studentName} is marked present.`);
      onDone();
    } catch (caught) {
      setError(problemText(caught, 'That did not save. Check your connection and try again.'));
      setBusy(false);
    }
  }

  return (
    <form className="rp-reason" onSubmit={(event) => void submit(event)} noValidate>
      <label className="account-field">
        <span className="rp-label-row">
          <span>{action === 'revoke' ? 'Why remove this check-in?' : 'Why mark them present?'}</span>
          <span className="rp-label-aside">{reason.trim().length}/500</span>
        </span>
        <textarea
          ref={field}
          value={reason}
          onChange={(event) => { setReason(event.target.value); setError(''); }}
          rows={3}
          maxLength={500}
          aria-describedby="rp-reason-hint"
        />
        <small id="rp-reason-hint">Kept with the record for good. The student sees the change in My attendance.</small>
      </label>
      <div className="ui-dialog-chips">
        {REASONS[action].map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className={`lx-chip-button${reason === suggestion ? ' is-selected' : ''}`}
            onClick={() => { setReason(suggestion); setError(''); }}
          >
            {suggestion}
          </button>
        ))}
      </div>
      {error ? <p className="rp-error" role="alert">{error}</p> : null}
      <div className="rp-actions">
        <Button variant="gray" block disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant={action === 'revoke' ? 'destructive' : 'filled'} block busy={busy}>
          {action === 'revoke' ? 'Remove' : 'Mark present'}
        </Button>
      </div>
    </form>
  );
}
