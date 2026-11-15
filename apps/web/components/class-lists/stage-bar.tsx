import type { ClassList } from '@lasuatos/contracts';
import { STAGE, STAGE_ORDER, stageCounts } from './format';

/**
 * How far a list has got, as one bar: ready, email confirmed, opened, then not opened, each
 * as wide as its share. Screen readers hear the same in words.
 */
export function StageBar({ counts, compact = false }: Readonly<{ counts: ClassList['counts']; compact?: boolean }>) {
  const split = stageCounts(counts);
  const order = [...STAGE_ORDER].reverse();
  const words = order.filter((stage) => split[stage] > 0).map((stage) => `${split[stage]} ${STAGE[stage].label.toLowerCase()}`).join(', ');
  return (
    <span className={`cls-bar${compact ? ' is-compact' : ''}`} role="img" aria-label={counts.total ? words : 'No students yet'}>
      {counts.total > 0
        ? order.map((stage) => (split[stage] > 0 ? <span key={stage} className={`cls-bar-part is-${STAGE[stage].param}`} style={{ flexGrow: split[stage] }} /> : null))
        : null}
    </span>
  );
}
