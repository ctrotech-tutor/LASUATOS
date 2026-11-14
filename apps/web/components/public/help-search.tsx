'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/** Words people type for the same thing, so "pin" finds "password". */
const ALIASES: Record<string, string> = {
  pin: 'password',
  pass: 'password',
  login: 'sign in',
  signin: 'sign in',
  camera: 'face',
  selfie: 'face',
  gps: 'location',
  qrcode: 'qr',
  scan: 'qr',
  rep: 'class rep',
  hoc: 'hoc',
  excel: 'excel',
};

function termsFor(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 1)
    .map((term) => ALIASES[term] ?? term);
}

/** Opens the answer named in the address (#q-…), so shared links land on it. */
function openFromHash() {
  const id = decodeURIComponent(window.location.hash.slice(1));
  if (!id) return;
  const node = document.getElementById(id);
  if (node instanceof HTMLDetailsElement) {
    node.open = true;
    node.classList.remove('is-flash');
    // Restart the highlight even when the same answer is opened twice.
    void node.offsetWidth;
    node.classList.add('is-flash');
  }
}

/**
 * Filters the help answers as you type. The answers are server-rendered;
 * this only hides the ones that do not match, so it works on any phone and
 * nothing is downloaded twice.
 */
export function HelpSearch({ targetId }: Readonly<{ targetId: string }>) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (event.key === '/' && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('hashchange', openFromHash);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  function apply(value: string) {
    setQuery(value);
    const root = document.getElementById(targetId);
    if (!root) return;
    const terms = termsFor(value);
    let shown = 0;
    root.querySelectorAll<HTMLDetailsElement>('[data-faq]').forEach((item) => {
      const text = (item.textContent ?? '').toLowerCase();
      const match = terms.every((term) => text.includes(term));
      item.hidden = !match;
      if (match) shown += 1;
    });
    root.querySelectorAll<HTMLElement>('[data-faq-group]').forEach((group) => {
      group.hidden = group.querySelector('[data-faq]:not([hidden])') === null;
    });
    if (terms.length > 0) root.setAttribute('data-searching', '');
    else root.removeAttribute('data-searching');
    setFound(terms.length > 0 ? shown : null);
  }

  return (
    <div className="pg-search" role="search">
      <label className="pg-search-field">
        <Search size={21} aria-hidden="true" />
        <span className="sr-only">Search help</span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => apply(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') apply('');
            if (event.key === 'Enter') {
              event.preventDefault();
              document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }}
          placeholder="Search: password, QR, face…"
          autoComplete="off"
          enterKeyHint="search"
          aria-controls={targetId}
        />
        {query ? (
          <button className="pg-search-clear" type="button" onClick={() => { apply(''); inputRef.current?.focus(); }} aria-label="Clear search">
            <X size={18} aria-hidden="true" />
          </button>
        ) : (
          <kbd className="pg-search-key" aria-hidden="true">/</kbd>
        )}
      </label>
      <p className="pg-search-status" aria-live="polite">
        {found === null ? null : found > 0 ? (
          <>
            <strong>{found}</strong> {found === 1 ? 'answer' : 'answers'} below for “{query.trim()}”.{' '}
            <a href={`#${targetId}`}>See {found === 1 ? 'it' : 'them'}</a>
          </>
        ) : (
          <>No answer matches “{query.trim()}”. Try fewer words, such as <em>password</em>, <em>QR</em> or <em>face</em>, or ask your class rep.</>
        )}
      </p>
    </div>
  );
}
