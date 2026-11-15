'use client';

import { type RenameCoursePrefixResult } from '@lasuatos/contracts';
import { ArrowRight, TriangleAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { failureText, renameCoursePrefix } from '../../lib/lecture-api';
import { Button, Sheet } from '../ds';
import { useFeedback } from '../feedback';
import { Select } from '../ui/select';
import { SwitchField } from '../ui/switch';
import { plural, renameProblem } from './format';

/**
 * Renames every course that starts with one prefix, e.g. when the GET courses are taught as MEE.
 * Nothing is saved until the preview has shown each change and anything that would be skipped.
 */
export function RenameSheet({ open, prefixes, onClose, onApplied }: Readonly<{
  open: boolean;
  prefixes: readonly { readonly prefix: string; readonly count: number }[];
  onClose: () => void;
  onApplied: (to: string) => void;
}>) {
  return (
    <Sheet open={open} onClose={onClose} title="Rename a code prefix">
      {open ? <RenameForm prefixes={prefixes} onClose={onClose} onApplied={onApplied} /> : null}
    </Sheet>
  );
}

function RenameForm({ prefixes, onClose, onApplied }: Readonly<{
  prefixes: readonly { readonly prefix: string; readonly count: number }[];
  onClose: () => void;
  onApplied: (to: string) => void;
}>) {
  const feedback = useFeedback();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [moveSessions, setMoveSessions] = useState(true);
  const [preview, setPreview] = useState<RenameCoursePrefixResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sessions = preview?.changes.reduce((sum, change) => sum + change.sessionCount, 0) ?? 0;

  function edit(change: () => void) {
    change();
    setPreview(null);
    setError('');
  }

  async function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = renameProblem(from, to);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');
    try {
      setPreview(await renameCoursePrefix({ from, to, moveSessions, apply: false }));
    } catch (caught) {
      setError(failureText(caught, 'The preview could not be made. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!preview?.changes.length) return;
    const count = plural(preview.changes.length, 'course');
    const sure = await feedback.confirm({
      title: `Rename ${count} from ${from} to ${to}?`,
      body: moveSessions && sessions
        ? `${plural(sessions, 'session')} already taken move to the new codes, so their registers continue. Everything changes together or not at all.`
        : 'Sessions already taken keep their old codes; new sessions use the new ones. Everything changes together or not at all.',
      confirmLabel: 'Rename courses',
    });
    if (!sure) return;
    setBusy(true);
    setError('');
    try {
      const result = await renameCoursePrefix({ from, to, moveSessions, apply: true });
      feedback.toast(`${plural(result.changes.length, 'course')} renamed to ${to}${result.sessionsMoved ? `, ${plural(result.sessionsMoved, 'session')} moved` : ''}.`);
      onApplied(to);
      onClose();
    } catch (caught) {
      setError(failureText(caught, 'The rename was not applied. Nothing was changed.'));
      setBusy(false);
    }
  }

  return (
    <form className="crs-rename" onSubmit={(event) => void check(event)} noValidate>
      <p className="crs-fine">When a department’s codes change, rename all its courses at once. You see every change before anything is saved.</p>
      <div className="crs-rename-fields">
        <label className="crs-field">
          <span>Current prefix</span>
          <Select
            value={from}
            onValueChange={(next) => edit(() => setFrom(next))}
            placeholder="Choose"
            searchable={prefixes.length > 8}
            options={prefixes.map((item) => ({ value: item.prefix, label: item.prefix, description: plural(item.count, 'course') }))}
          />
        </label>
        <ArrowRight className="crs-rename-arrow" size={18} aria-hidden="true" />
        <label className="crs-field">
          <span>New prefix</span>
          <input
            className="crs-input"
            value={to}
            onChange={(event) => edit(() => setTo(event.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5)))}
            placeholder="e.g. MEE"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={5}
          />
        </label>
      </div>
      <SwitchField
        checked={moveSessions}
        onCheckedChange={(next) => edit(() => setMoveSessions(next))}
        label="Move sessions already taken to the new codes"
        hint="Keeps each course’s register together. Turn off to leave past sessions under the old codes."
      />
      {error ? <p className="crs-error" role="alert">{error}</p> : null}

      {preview ? (
        <div className="crs-preview" aria-live="polite">
          <h3 className="crs-block-title">{preview.changes.length ? `${plural(preview.changes.length, 'course')} will change` : 'Nothing can be renamed'}</h3>
          {preview.changes.length ? (
            <ul className="ds-list crs-preview-list">
              {preview.changes.map((change) => (
                <li key={change.fromCode} className="crs-preview-row">
                  <span className="crs-code is-old">{change.fromCode}</span>
                  <ArrowRight size={14} aria-label="becomes" />
                  <span className="crs-code">{change.toCode}</span>
                  <span className="crs-preview-title">{change.title}</span>
                  {change.sessionCount ? <small>{plural(change.sessionCount, 'session')} {moveSessions ? 'move' : 'stay'}</small> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {preview.conflicts.length ? (
            <div className="crs-conflicts">
              <p className="crs-conflicts-head"><TriangleAlert size={16} aria-hidden="true" /> {plural(preview.conflicts.length, 'course')} will be skipped</p>
              <ul>
                {preview.conflicts.map((conflict) => (
                  <li key={conflict.fromCode}><strong>{conflict.fromCode} to {conflict.toCode}:</strong> {conflict.reason}</li>
                ))}
              </ul>
              <p className="crs-fine">Fix these one at a time: open the course and choose Edit.</p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="crs-sheet-actions">
        {preview?.changes.length ? (
          <Button busy={busy} onClick={() => void apply()}>{`Rename ${plural(preview.changes.length, 'course')}`}</Button>
        ) : (
          <Button type="submit" busy={busy}>Preview changes</Button>
        )}
        <Button variant="gray" onClick={preview ? () => setPreview(null) : onClose} disabled={busy}>{preview ? 'Back' : 'Cancel'}</Button>
      </div>
    </form>
  );
}
