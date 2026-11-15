'use client';

import type { LectureRegister } from '@lasuatos/contracts';
import { Download, Printer, SlidersHorizontal } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { formatDay, loadCourseRegister } from '../../lib/lecture-api';
import { useResource } from '../../lib/resource';
import { Button, EmptyState, List, ListRow, Menu, PageHeader, RateMeter, SegmentedControl, Sheet, Stat, Stats } from '../ds';
import { GuideButton } from '../shell/guide-button';
import { AccessMessage, useTakerAccess } from '../take-attendance/access';
import { SearchField } from '../ui/search-field';
import { Select } from '../ui/select';
import { downloadRegister, numberFormat, plural, sorters, THRESHOLDS, type RegisterSort } from './format';
import { RegisterGrid } from './grid';
import { setThreshold, useThreshold } from './threshold';
import { StudentSheet } from './student-sheet';
import './registers.css';

type Student = LectureRegister['students'][number];
const BACK = { href: '/registers', label: 'Registers' };
const TERM = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|other|all)$/i;
const SORTS = [
  { value: 'name', label: 'Name' },
  { value: 'matric', label: 'Matric' },
  { value: 'rate', label: 'Lowest' },
] as const;

// One loader per course and semester, so useResource sees a stable function.
const loaders = new Map<string, (signal: AbortSignal) => Promise<LectureRegister>>();
function loaderFor(code: string, term: string | null) {
  const key = `${code}|${term ?? ''}`;
  let loader = loaders.get(key);
  if (!loader) {
    loader = (signal) => loadCourseRegister(code, term ?? undefined, signal);
    loaders.set(key, loader);
  }
  return loader;
}
const keyFor = (code: string, term: string | null) => `register:${code}:${term ?? 'latest'}`;

/**
 * One course's register: every student against every class, for exam eligibility. The
 * semester is in the address (?term=); a link to one student arrives with ?q=.
 */
export function CourseRegister({ code }: Readonly<{ code: string }>) {
  const { access, retry } = useTakerAccess();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const termParam = params?.get('term') ?? null;
  const term = termParam && TERM.test(termParam) ? termParam.toLowerCase() : null;
  const [previousTerm, setPreviousTerm] = useState<string | null | undefined>(undefined);

  const ready = access.kind === 'ready';
  const current = useResource(ready ? keyFor(code, term) : null, loaderFor(code, term), { maxAge: 30_000 });
  const showPrevious = previousTerm !== undefined && previousTerm !== term;
  const fallback = useResource(ready && showPrevious ? keyFor(code, previousTerm) : null, loaderFor(code, previousTerm ?? null), { maxAge: Infinity });
  const register = current.data ?? fallback.data;

  if (access.kind !== 'ready' && access.kind !== 'loading') return <div className="rg"><AccessMessage access={access} retry={retry} /></div>;

  function chooseTerm(next: string) {
    setPreviousTerm(term);
    const query = new URLSearchParams(params?.toString());
    query.set('term', next);
    query.delete('q');
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  }

  if (!register) {
    return (
      <div className="rg rg-register">
        <PageHeader back={BACK} eyebrow={code} title={current.error ? 'Register' : <span className="ds-skeleton rg-title-bone" />} />
        {current.error ? (
          <div className="ds-card">
            {current.error.startsWith('No sessions for') ? (
              <EmptyState title={`No register for ${code}`} message="A course gets a register when attendance is first taken for it." action={<Button variant="tinted" href="/registers">All registers</Button>} />
            ) : (
              <EmptyState error title="This register did not load" message={current.error} action={<Button variant="tinted" onClick={current.reload}>Try again</Button>} />
            )}
          </div>
        ) : <RegisterSkeleton />}
      </div>
    );
  }

  return (
    <RegisterBody
      key={`${register.courseCode}|${register.term?.id ?? ''}`}
      register={register}
      stale={!current.data}
      initialQuery={params?.get('q')?.trim() ?? ''}
      onTerm={chooseTerm}
    />
  );
}

function RegisterBody({ register, stale, initialQuery, onTerm }: Readonly<{
  register: LectureRegister;
  stale: boolean;
  initialQuery: string;
  onTerm: (term: string) => void;
}>) {
  const threshold = useThreshold();
  const [query, setQuery] = useState(initialQuery);
  const [show, setShow] = useState<'all' | 'below'>('all');
  const [sort, setSort] = useState<RegisterSort>('name');
  const [options, setOptions] = useState(false);
  const [person, setPerson] = useState<Student | null>(null);

  const held = register.sessions.length;
  const stats = useMemo(() => {
    const total = register.students.length;
    const average = total ? register.students.reduce((sum, row) => sum + row.rate, 0) / total : null;
    return { total, average, below: register.students.filter((row) => row.rate < threshold).length };
  }, [register.students, threshold]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/\s+/g, '');
    return register.students
      .filter((row) => (show === 'all' || row.rate < threshold)
        && (!needle || row.fullName.toLowerCase().replace(/\s+/g, '').includes(needle) || row.matricNumber.toLowerCase().includes(needle)))
      .sort(sorters[sort]);
  }, [register.students, query, show, threshold, sort]);

  const first = register.sessions[0]!;
  const last = register.sessions[held - 1]!;
  const span = formatDay(first.startsAt) === formatDay(last.startsAt) ? formatDay(first.startsAt) : `${formatDay(first.startsAt).replace(/ \d{4}$/, '')} – ${formatDay(last.startsAt)}`;
  const namedTerm = register.term && register.term.id !== 'all' && register.term.id !== 'other' ? register.term.label : null;
  const caption = `${register.courseCode} · ${register.courseTitle}: attendance register${namedTerm ? `, ${namedTerm}` : ''} (${plural(held, 'session')}, ${threshold}% required)`;

  return (
    <div className={`rg rg-register${stale ? ' is-stale' : ''}`} aria-busy={stale}>
      <PageHeader
        back={BACK}
        eyebrow={register.courseCode}
        title={register.courseTitle}
        subtitle={register.terms.length > 1 ? span : [namedTerm, span].filter(Boolean).join(' · ')}
        actions={(
          <div className="rg-head-actions">
            <GuideButton page="/registers" label="Course registers" />
            <Menu
              label="Register actions"
              title={register.courseCode}
              items={[
                { label: 'Download for Excel', icon: <Download size={18} strokeWidth={2.1} />, onSelect: () => downloadRegister(register, threshold) },
                { label: 'Print', icon: <Printer size={18} strokeWidth={2.1} />, onSelect: () => window.print() },
              ]}
            />
          </div>
        )}
      />

      {register.terms.length > 1 ? (
        <div className="rg-term">
          <Select
            size="sm"
            aria-label="Semester"
            value={register.term?.id ?? ''}
            onValueChange={onTerm}
            disabled={stale}
            options={register.terms.map((item) => ({ value: item.id, label: `${item.label} · ${plural(item.sessionCount, 'session')}` }))}
          />
        </div>
      ) : null}

      <Stats label="Summary">
        <Stat label="Sessions" value={numberFormat.format(held)} />
        <Stat label="Students" value={numberFormat.format(stats.total)} />
        <Stat label="Average" value={<RateMeter rate={stats.average} threshold={threshold} />} />
        <Stat label={`Below ${threshold}%`} value={numberFormat.format(stats.below)} tone={stats.below ? 'warning' : undefined} />
      </Stats>

      <div className="rg-toolbar">
        <SearchField className="rg-search" value={query} onValueChange={setQuery} placeholder="Name or matric" aria-label="Find a student" />
        <SegmentedControl
          label="Show"
          value={show}
          onChange={setShow}
          segments={[
            { value: 'all', label: `Everyone ${numberFormat.format(stats.total)}` },
            { value: 'below', label: `Below ${threshold}% ${numberFormat.format(stats.below)}` },
          ]}
        />
        <button className="ds-icon-btn rg-options" type="button" aria-label="Sort and required attendance" data-tip="Sort and required" onClick={() => setOptions(true)}>
          <SlidersHorizontal size={18} strokeWidth={2.1} aria-hidden="true" />
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="rg-quiet" role="status">
          {query.trim() ? `No student matches “${query.trim()}”.` : `Everyone is at ${threshold}% or above.`}
        </p>
      ) : (
        <>
          <RegisterGrid register={register} rows={rows} threshold={threshold} caption={caption} onOpen={setPerson} />
          <List className="rg-people" label={`${register.courseCode} students`}>
            {rows.map((row) => (
              <ListRow
                key={row.matricNumber}
                onClick={() => setPerson(row)}
                title={row.fullName}
                subtitle={<><span className="ds-mono">{row.matricNumber}</span> · {row.attended} of {held}</>}
                trailing={<RateMeter rate={row.rate} threshold={threshold} />}
              />
            ))}
          </List>
        </>
      )}

      <Sheet open={options} onClose={() => setOptions(false)} title="Register options">
        <div className="rg-options-sheet">
          <section className="ds-section">
            <div className="ds-section-head"><h3 className="ds-section-title rg-sheet-title">Sort by</h3></div>
            <SegmentedControl label="Sort by" segments={SORTS} value={sort} onChange={setSort} block />
          </section>
          <section className="ds-section">
            <div className="ds-section-head"><h3 className="ds-section-title rg-sheet-title">Required attendance</h3></div>
            <SegmentedControl
              label="Required attendance"
              segments={THRESHOLDS.map((value) => ({ value: String(value), label: `${value}%` }))}
              value={String(threshold)}
              onChange={(value) => setThreshold(Number(value))}
              block
            />
            <p className="ds-section-foot">Used for this list, the download and the printout, on this device.</p>
          </section>
        </div>
      </Sheet>

      <StudentSheet register={register} student={person} threshold={threshold} onClose={() => setPerson(null)} />
    </div>
  );
}

function RegisterSkeleton() {
  return (
    <div className="rg-skeleton" role="status" aria-label="Loading the register">
      <div className="ds-stats" aria-hidden="true">
        {[0, 1, 2, 3].map((key) => <div key={key} className="ds-stat"><span className="ds-skeleton" style={{ width: '50%', height: 12 }} /><span className="ds-skeleton" style={{ width: '40%', height: 24 }} /></div>)}
      </div>
      <div className="ds-card rg-grid-bone" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((key) => <span key={key} className="ds-skeleton" style={{ height: 18 }} />)}
      </div>
    </div>
  );
}
