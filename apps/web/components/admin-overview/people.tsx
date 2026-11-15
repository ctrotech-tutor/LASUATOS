'use client';

import type { AdministratorOverview } from '@lasuatos/contracts';
import type { CSSProperties } from 'react';
import { numberFormat, plural } from './format';

type LevelGroup = AdministratorOverview['studentLevels'][number];

/** Who is in the administrator's area, and students by level as one stacked bar. */
export function People({ overview }: Readonly<{ overview: AdministratorOverview | undefined }>) {
  if (!overview) {
    return (
      <section className="ds-section ov-people-section" aria-labelledby="ov-people-title">
        <div className="ds-section-head"><h2 className="ds-section-title" id="ov-people-title">People</h2></div>
        <div className="ds-card ov-people" role="status" aria-label="Loading people">
          <div className="ov-figures">
            {[0, 1, 2].map((key) => (
              <div key={key}><span className="ds-skeleton" style={{ width: 54, height: 26 }} /><span className="ds-skeleton ov-bone-small" style={{ width: 64, marginTop: 6 }} /></div>
            ))}
          </div>
        </div>
      </section>
    );
  }
  const { metrics, studentLevels } = overview;
  const figures = [
    { label: 'Students', value: metrics.activeStudents },
    { label: 'Lecturers', value: metrics.activeLecturers },
    { label: metrics.departments === 1 ? 'Department' : 'Departments', value: metrics.departments },
    ...(metrics.courseOfferings > 0 || metrics.activeEnrollments > 0
      ? [
        { label: 'Course offerings', value: metrics.courseOfferings },
        { label: 'Enrolments', value: metrics.activeEnrollments },
      ]
      : []),
  ];
  return (
    <section className="ds-section ov-people-section" aria-labelledby="ov-people-title">
      <div className="ds-section-head">
        <h2 className="ds-section-title" id="ov-people-title">People</h2>
      </div>
      <div className="ds-card ov-people">
        <dl className="ov-figures">
          {figures.map((figure) => (
            <div key={figure.label}>
              <dt>{figure.label}</dt>
              <dd>{numberFormat.format(figure.value)}</dd>
            </div>
          ))}
        </dl>
        {studentLevels.some((group) => group.level !== null && group.count > 0) ? <Levels groups={studentLevels} /> : null}
      </div>
    </section>
  );
}

const levelName = (group: LevelGroup) => (group.label.includes('extra') ? `Extra year` : `${group.level}L`);

function Levels({ groups }: Readonly<{ groups: readonly LevelGroup[] }>) {
  const levelled = groups.filter((group) => group.level !== null && group.count > 0);
  const unplaced = groups.filter((group) => group.level === null).reduce((sum, group) => sum + group.count, 0);
  const total = levelled.reduce((sum, group) => sum + group.count, 0);
  const share = (count: number) => Math.round((count / total) * 100);
  // Lighter for the first years, darker for the final ones.
  const strength = (index: number) => (levelled.length === 1 ? 1 : 0.28 + (0.72 * index) / (levelled.length - 1));
  const description = `Students by level: ${levelled.map((group) => `${levelName(group)} ${numberFormat.format(group.count)} (${share(group.count)}%)`).join(', ')}.`;
  return (
    <div className="ov-levels">
      <p className="ov-levels-title">By level</p>
      <div className="ov-levels-bar" role="img" aria-label={description}>
        {levelled.map((group, index) => (
          <span
            key={group.label}
            style={{ flexGrow: group.count, '--strength': strength(index).toFixed(3) } as CSSProperties}
            data-tip={`${levelName(group)}: ${plural(group.count, 'student')}, ${share(group.count)}%`}
          />
        ))}
      </div>
      <ul className="ov-levels-legend" aria-hidden="true">
        {levelled.map((group, index) => (
          <li key={group.label}>
            <i style={{ '--strength': strength(index).toFixed(3) } as CSSProperties} />
            <span>{levelName(group)}</span>
            <strong>{numberFormat.format(group.count)}</strong>
          </li>
        ))}
      </ul>
      {unplaced ? <p className="ov-levels-note">{plural(unplaced, 'student')} without a level from their matric number</p> : null}
    </div>
  );
}
