'use client';

import { Search, X } from 'lucide-react';
import { useRef, type InputHTMLAttributes } from 'react';

/* A search box with the app's own clear button (the browser's "×" is hidden). */

type SearchFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
};

export function SearchField({ value, onValueChange, className, ...input }: SearchFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <span className={`ui-search${className ? ` ${className}` : ''}`}>
      <Search className="ui-search-icon" size={16} aria-hidden="true" />
      <input
        ref={inputRef}
        className="ui-search-input"
        type="search"
        enterKeyHint="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Escape' && value) { event.preventDefault(); onValueChange(''); } }}
        {...input}
      />
      {value ? (
        <button type="button" className="ui-search-clear" aria-label="Clear search"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => { onValueChange(''); inputRef.current?.focus(); }}>
          <X size={15} strokeWidth={2.4} aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}
