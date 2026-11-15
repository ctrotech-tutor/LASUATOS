'use client';

import type { AdminBuilding, AdminCampus, AdminVenue } from '@lasuatos/contracts';
import { Building2, Pencil, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { createBuilding, createVenue, updateBuilding, updateVenue } from '../../lib/venue-api';
import { Button, Sheet } from '../ds';
import { useFeedback } from '../feedback';
import { EditDialog, formText } from '../ui/edit-dialog';
import { NumberField } from '../ui/number-field';
import { Select } from '../ui/select';
import { TYPE_OPTIONS, type VenueType } from './format';

const CODE_PATTERN = '[A-Za-z0-9][A-Za-z0-9._\\-]*';
const NEW_BUILDING = '__new';

/** Messages from venue-api, which throws plain `{ status, message }` objects (or zod issues). */
function failure(caught: unknown, fallback: string): string {
  const value = caught as { status?: number; message?: string; issues?: unknown };
  if (value?.status === 403) return 'Only institution administrators can change venues.';
  if (value?.status === 409) return value.message ?? 'That code is already used on this campus.';
  if (value && 'issues' in value) return 'Check the values and try again.';
  return value?.message ?? fallback;
}

function nullable(text: string): string | null {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed : null;
}

/** Adds a venue, and a building for it when the building is new. */
export function AddVenueSheet({ open, campuses, buildings, defaultCampusId, onClose, onCreated, onBuildingCreated }: Readonly<{
  open: boolean;
  campuses: readonly AdminCampus[];
  buildings: readonly AdminBuilding[];
  defaultCampusId: string | null;
  onClose: () => void;
  onCreated: (venue: AdminVenue) => void;
  onBuildingCreated: (building: AdminBuilding) => void;
}>) {
  return (
    <Sheet open={open} onClose={onClose} title="Add a venue" size="wide">
      {open ? <AddVenueForm campuses={campuses} buildings={buildings} defaultCampusId={defaultCampusId} onCancel={onClose} onCreated={onCreated} onBuildingCreated={onBuildingCreated} /> : null}
    </Sheet>
  );
}

function AddVenueForm({ campuses, buildings, defaultCampusId, onCancel, onCreated, onBuildingCreated }: Readonly<{
  campuses: readonly AdminCampus[];
  buildings: readonly AdminBuilding[];
  defaultCampusId: string | null;
  onCancel: () => void;
  onCreated: (venue: AdminVenue) => void;
  onBuildingCreated: (building: AdminBuilding) => void;
}>) {
  const feedback = useFeedback();
  const active = campuses.filter((campus) => campus.isActive);
  const [campusId, setCampusId] = useState(defaultCampusId ?? (active.length === 1 ? active[0]!.id : ''));
  const [buildingId, setBuildingId] = useState('');
  const [venueType, setVenueType] = useState<VenueType>('lecture_theatre');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const campusBuildings = buildings.filter((building) => building.campusId === campusId && building.isActive);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!campusId) {
      setError('Choose the campus first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      let building = buildingId && buildingId !== NEW_BUILDING ? buildingId : null;
      if (buildingId === NEW_BUILDING) {
        const created = await createBuilding({ campusId, name: formText(form, 'buildingName').replace(/\s+/g, ' '), code: formText(form, 'buildingCode').toUpperCase() });
        onBuildingCreated(created.building);
        building = created.building.id;
        setBuildingId(created.building.id);
      }
      const capacity = formText(form, 'capacity');
      const result = await createVenue({
        campusId,
        buildingId: building,
        code: formText(form, 'code').toUpperCase(),
        name: formText(form, 'name').replace(/\s+/g, ' '),
        venueType,
        floorLabel: nullable(formText(form, 'floorLabel')),
        sectionLabel: nullable(formText(form, 'sectionLabel')),
        capacity: capacity ? Number(capacity) : null,
        notes: nullable(formText(form, 'notes')),
        locationRequired: true,
      });
      if (result.status === 'already_exists') {
        setError(`${result.venue.code} already exists on ${result.venue.campusName}. Open it from the list instead.`);
        setBusy(false);
        return;
      }
      feedback.toast(`${result.venue.code} added. Set its location next.`);
      onCreated(result.venue);
    } catch (caught) {
      setError(failure(caught, 'The venue could not be added. Try again.'));
      setBusy(false);
    }
  }

  return (
    <form className="vnu-form" onSubmit={(event) => void submit(event)} noValidate={false}>
      {active.length > 1 ? (
        <label className="account-field">
          <span>Campus</span>
          <Select
            value={campusId}
            required
            placeholder="Choose a campus"
            onValueChange={(value) => { setCampusId(value); setBuildingId(''); }}
            options={active.map((campus) => ({ value: campus.id, label: campus.name }))}
          />
        </label>
      ) : null}
      <div className="vnu-pair">
        <label className="account-field">
          <span>Code</span>
          <input name="code" required maxLength={40} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="LT-01"
            pattern={CODE_PATTERN} data-pattern-message="Use letters and numbers, with . _ or - between, like LT-01." className="vnu-upper" />
        </label>
        <label className="account-field">
          <span>Name</span>
          <input name="name" required maxLength={160} autoComplete="off" placeholder="Lecture Theatre 1" />
        </label>
      </div>
      <div className="vnu-pair">
        <label className="account-field">
          <span>Type</span>
          <Select value={venueType} onValueChange={(value) => setVenueType(value as VenueType)} options={TYPE_OPTIONS} />
        </label>
        <label className="account-field">
          <span>Seats <small>optional</small></span>
          <NumberField name="capacity" min={1} max={20000} step={1} nudge={10} placeholder="400" />
        </label>
      </div>
      <label className="account-field">
        <span>Building <small>optional</small></span>
        <Select
          value={buildingId}
          disabled={!campusId}
          onValueChange={setBuildingId}
          options={[
            { value: '', label: 'Not in a building' },
            ...campusBuildings.map((building) => ({ value: building.id, label: building.name, description: building.code })),
            { value: NEW_BUILDING, label: 'New building…' },
          ]}
        />
      </label>
      {buildingId === NEW_BUILDING ? (
        <div className="vnu-pair vnu-nested">
          <label className="account-field">
            <span>Building name</span>
            <input name="buildingName" required maxLength={160} placeholder="Engineering Complex" />
          </label>
          <label className="account-field">
            <span>Building code</span>
            <input name="buildingCode" required maxLength={40} autoCapitalize="characters" spellCheck={false} placeholder="ENG-CMPX"
              pattern={CODE_PATTERN} data-pattern-message="Use letters and numbers, with . _ or - between, like ENG-CMPX." className="vnu-upper" />
          </label>
        </div>
      ) : null}
      <div className="vnu-pair">
        <label className="account-field">
          <span>Floor <small>optional</small></span>
          <input name="floorLabel" maxLength={40} placeholder="Ground floor" />
        </label>
        <label className="account-field">
          <span>Section <small>optional</small></span>
          <input name="sectionLabel" maxLength={80} placeholder="East wing" />
        </label>
      </div>
      <label className="account-field">
        <span>Notes <small>optional</small></span>
        <textarea name="notes" maxLength={500} rows={2} placeholder="How to get in, or which rooms share a wall" />
      </label>
      {error ? <p className="vnu-field-error" role="alert">{error}</p> : null}
      <p className="vnu-fine">It starts inactive. Set its location, then activate it.</p>
      <div className="vnu-form-actions">
        <Button variant="gray" onClick={onCancel}>Cancel</Button>
        <Button type="submit" busy={busy}>Add venue</Button>
      </div>
    </form>
  );
}

/** Every building, by campus, with how many venues it holds. Correct one, or add one. */
export function BuildingsSheet({ open, campuses, buildings, venues, onClose, onSaved }: Readonly<{
  open: boolean;
  campuses: readonly AdminCampus[];
  buildings: readonly AdminBuilding[];
  venues: readonly AdminVenue[];
  onClose: () => void;
  onSaved: (building: AdminBuilding) => void;
}>) {
  const feedback = useFeedback();
  const [editing, setEditing] = useState<AdminBuilding | null>(null);
  const [adding, setAdding] = useState(false);
  const [campusId, setCampusId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const counts = new Map<string, number>();
  for (const venue of venues) if (venue.buildingId) counts.set(venue.buildingId, (counts.get(venue.buildingId) ?? 0) + 1);
  const groups = campuses
    .map((campus) => ({ campus, buildings: buildings.filter((building) => building.campusId === campus.id).sort((a, b) => a.name.localeCompare(b.name)) }))
    .filter((group) => group.buildings.length || campuses.length === 1);
  const chosenCampus = campusId || (campuses.length === 1 ? campuses[0]!.id : '');

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!chosenCampus) {
      setError('Choose the campus first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await createBuilding({ campusId: chosenCampus, name: formText(form, 'name').replace(/\s+/g, ' '), code: formText(form, 'code').toUpperCase() });
      onSaved(result.building);
      feedback.toast(`${result.building.name} added.`);
      form.reset();
      setAdding(false);
    } catch (caught) {
      setError(failure(caught, 'The building could not be added. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Buildings">
      <div className="vnu-buildings">
        {groups.map((group) => (
          <section key={group.campus.id} aria-label={group.campus.name}>
            {campuses.length > 1 ? <h3 className="vnu-block-title">{group.campus.name}</h3> : null}
            {group.buildings.length ? (
              <ul className="ds-list">
                {group.buildings.map((building) => (
                  <li key={building.id}>
                    <button className="ds-row" type="button" onClick={() => setEditing(building)}>
                      <span className="vnu-glyph is-building" aria-hidden="true"><Building2 size={18} strokeWidth={2.2} /></span>
                      <span className="ds-row-body">
                        <span className="ds-row-title">{building.name}</span>
                        <span className="ds-row-subtitle"><span className="ds-mono">{building.code}</span> · {counts.get(building.id) === 1 ? '1 venue' : `${counts.get(building.id) ?? 0} venues`}</span>
                      </span>
                      <Pencil className="ds-row-chevron" size={16} strokeWidth={2.2} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="vnu-fine">No buildings yet.</p>}
          </section>
        ))}
        {adding ? (
          <form className="vnu-form vnu-nested" onSubmit={(event) => void add(event)}>
            {campuses.length > 1 ? (
              <label className="account-field">
                <span>Campus</span>
                <Select value={campusId} required placeholder="Choose a campus" onValueChange={setCampusId} options={campuses.filter((campus) => campus.isActive).map((campus) => ({ value: campus.id, label: campus.name }))} />
              </label>
            ) : null}
            <div className="vnu-pair">
              <label className="account-field">
                <span>Building name</span>
                <input name="name" required maxLength={160} placeholder="Engineering Complex" />
              </label>
              <label className="account-field">
                <span>Code</span>
                <input name="code" required maxLength={40} autoCapitalize="characters" spellCheck={false} placeholder="ENG-CMPX"
                  pattern={CODE_PATTERN} data-pattern-message="Use letters and numbers, with . _ or - between, like ENG-CMPX." className="vnu-upper" />
              </label>
            </div>
            {error ? <p className="vnu-field-error" role="alert">{error}</p> : null}
            <div className="vnu-form-actions">
              <Button variant="gray" onClick={() => { setAdding(false); setError(''); }}>Cancel</Button>
              <Button type="submit" busy={busy}>Add building</Button>
            </div>
          </form>
        ) : (
          <Button variant="tinted" block onClick={() => setAdding(true)} icon={<Plus size={18} strokeWidth={2.2} aria-hidden="true" />}>Add a building</Button>
        )}
      </div>
      {editing ? (
        <EditBuildingDialog
          building={editing}
          onClose={() => setEditing(null)}
          onSaved={(building) => {
            setEditing(null);
            onSaved(building);
            feedback.toast('Building updated.');
          }}
        />
      ) : null}
    </Sheet>
  );
}

/** Sends only the fields that changed; null when nothing did. */
function changedFields<T extends Record<string, unknown>>(next: T, current: Record<string, unknown>): Partial<T> | null {
  const changed = Object.fromEntries(Object.entries(next).filter(([key, value]) => value !== current[key])) as Partial<T>;
  return Object.keys(changed).length ? changed : null;
}

export function EditVenueDialog({ venue, buildings, onClose, onSaved }: Readonly<{
  venue: AdminVenue;
  buildings: readonly AdminBuilding[];
  onClose: () => void;
  onSaved: (venue: AdminVenue) => void;
}>) {
  const feedback = useFeedback();
  const [venueType, setVenueType] = useState<VenueType>(venue.venueType);
  const [buildingId, setBuildingId] = useState(venue.buildingId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(form: HTMLFormElement) {
    const capacityText = formText(form, 'capacity');
    const changes = changedFields({
      code: formText(form, 'code').toUpperCase(),
      name: formText(form, 'name').replace(/\s+/g, ' '),
      venueType,
      buildingId: buildingId || null,
      floorLabel: nullable(formText(form, 'floorLabel')),
      sectionLabel: nullable(formText(form, 'sectionLabel')),
      capacity: capacityText ? Number(capacityText) : null,
      notes: nullable(formText(form, 'notes')),
    }, venue);
    if (!changes) {
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await updateVenue(venue.id, changes);
      feedback.toast('Venue updated.');
      onSaved(result.venue);
    } catch (caught) {
      setError(failure(caught, 'The venue could not be saved. Try again.'));
      setBusy(false);
    }
  }

  return (
    <EditDialog
      title={`Edit ${venue.code}`}
      description={`${venue.campusName}. The location is changed with Edit boundary.`}
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={save}
      wide
    >
      <div className="ui-edit-row">
        <label className="account-field">
          <span>Code</span>
          <input name="code" defaultValue={venue.code} required maxLength={40} autoCapitalize="characters" spellCheck={false} className="vnu-upper"
            pattern={CODE_PATTERN} data-pattern-message="Use letters and numbers, with . _ or - between, like LT-01." />
        </label>
        <label className="account-field">
          <span>Name</span>
          <input name="name" defaultValue={venue.name} required maxLength={160} />
        </label>
      </div>
      <div className="ui-edit-row">
        <label className="account-field">
          <span>Type</span>
          <Select value={venueType} onValueChange={(next) => setVenueType(next as VenueType)} options={TYPE_OPTIONS} />
        </label>
        <label className="account-field">
          <span>Building <small>optional</small></span>
          <Select
            value={buildingId}
            onValueChange={setBuildingId}
            options={[
              { value: '', label: 'Not in a building' },
              ...buildings.map((building) => ({ value: building.id, label: building.name, description: building.code })),
            ]}
          />
        </label>
      </div>
      <div className="ui-edit-row is-three">
        <label className="account-field">
          <span>Floor <small>optional</small></span>
          <input name="floorLabel" defaultValue={venue.floorLabel ?? ''} maxLength={40} placeholder="Ground floor" />
        </label>
        <label className="account-field">
          <span>Section <small>optional</small></span>
          <input name="sectionLabel" defaultValue={venue.sectionLabel ?? ''} maxLength={80} placeholder="East wing" />
        </label>
        <label className="account-field">
          <span>Seats <small>optional</small></span>
          <NumberField name="capacity" defaultValue={venue.capacity ?? ''} min={1} max={20000} step={1} nudge={10} placeholder="400" />
        </label>
      </div>
      <label className="account-field">
        <span>Notes <small>optional</small></span>
        <textarea name="notes" defaultValue={venue.notes ?? ''} maxLength={500} rows={3} placeholder="How to get in, or which rooms share a wall" />
      </label>
    </EditDialog>
  );
}

function EditBuildingDialog({ building, onClose, onSaved }: Readonly<{ building: AdminBuilding; onClose: () => void; onSaved: (building: AdminBuilding) => void }>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(form: HTMLFormElement) {
    const changes = changedFields({ code: formText(form, 'code').toUpperCase(), name: formText(form, 'name').replace(/\s+/g, ' ') }, building);
    if (!changes) {
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await updateBuilding(building.id, changes);
      onSaved(result.building);
    } catch (caught) {
      setError(failure(caught, 'The building could not be saved. The code may already be used on this campus.'));
      setBusy(false);
    }
  }

  return (
    <EditDialog title={`Edit ${building.name}`} description="Venues in this building show the new name straight away." busy={busy} error={error} onClose={onClose} onSubmit={save}>
      <label className="account-field">
        <span>Building name</span>
        <input name="name" defaultValue={building.name} required maxLength={160} />
      </label>
      <label className="account-field">
        <span>Code</span>
        <input name="code" defaultValue={building.code} required maxLength={40} autoCapitalize="characters" spellCheck={false} className="vnu-upper"
          pattern={CODE_PATTERN} data-pattern-message="Use letters and numbers, with . _ or - between, like ENG-CMPX." />
      </label>
    </EditDialog>
  );
}
