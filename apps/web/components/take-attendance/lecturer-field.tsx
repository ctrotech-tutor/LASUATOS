'use client';

import type { LectureLecturerOptions } from '@lasuatos/contracts';
import { useMemo } from 'react';
import { loadLecturerOptions } from '../../lib/lecture-api';
import { useResource } from '../../lib/resource';
import { Combobox } from '../ui/combobox';

const LECTURERS_KEY = 'take:lecturers';
const loadLecturers = (signal: AbortSignal) => loadLecturerOptions(signal);

/**
 * Who teaches the class: pick one of the institution's lecturers (own department first) so the
 * name is spelled the same on every register, or type a name that is not on the list, such as
 * a visiting lecturer. Names typed before come back as suggestions.
 */
export function LecturerField({ value, onChange, placeholder }: Readonly<{
  value: string;
  onChange: (name: string) => void;
  placeholder: string;
}>) {
  // The staff list changes rarely: keep it for the tab, refreshed after five minutes.
  const options = useResource<LectureLecturerOptions>(LECTURERS_KEY, loadLecturers, { maxAge: 5 * 60_000 });
  const suggestions = useMemo(
    () => (options.data?.lecturers ?? []).map((item) => ({ value: item.name, label: item.departmentName ?? 'From an earlier session' })),
    [options.data],
  );
  return (
    <label className="account-field">
      <span>Lecturer</span>
      <Combobox
        value={value}
        onValueChange={onChange}
        suggestions={suggestions}
        limit={8}
        placeholder={placeholder}
        autoCapitalize="words"
        spellCheck={false}
        maxLength={160}
        enterKeyHint="next"
        // A name is usually replaced, not edited: select it so typing starts over.
        onFocus={(event) => event.currentTarget.select()}
      />
    </label>
  );
}
