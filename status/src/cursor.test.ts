import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CURSOR, CURSOR_CSS, CURSOR_SCRIPT, INTERACTIVE } from './cursor.ts';

/** The status page's cursor is a copy of the app's: these checks keep the two in step. */
const app = readFileSync(new URL('../../apps/web/components/public/site-cursor.tsx', import.meta.url), 'utf8');
const appCss = readFileSync(new URL('../../apps/web/app/globals.css', import.meta.url), 'utf8');

function appNumber(name: string): number {
  const match = new RegExp(`const ${name} = ([\\d_]+);`).exec(app);
  if (!match) throw new Error(`${name} not found in site-cursor.tsx`);
  return Number(match[1]!.replaceAll('_', ''));
}

describe('status page cursor', () => {
  it('uses the same sizes, easing and stall guard as the app', () => {
    expect(CURSOR.corner).toBe(appNumber('CORNER'));
    expect(CURSOR.free).toBe(appNumber('FREE'));
    expect(CURSOR.lockMaxW).toBe(appNumber('LOCK_MAX_W'));
    expect(CURSOR.lockMaxH).toBe(appNumber('LOCK_MAX_H'));
    expect(CURSOR.stallMs).toBe(appNumber('STALL_MS'));
    expect(CURSOR.stallsToStop).toBe(appNumber('STALLS_TO_STOP'));
    expect(CURSOR.stallWindowMs).toBe(appNumber('STALL_WINDOW_MS'));
    expect(app).toContain(`(lock ? ${CURSOR.easeLock} : ${CURSOR.easeFree})`);
  });

  it('locks on to the same things as the app', () => {
    const match = /export const INTERACTIVE = '([^']+)';/.exec(app);
    expect(match?.[1]).toBe(INTERACTIVE);
  });

  it('uses the app colours', () => {
    const block = appCss.slice(appCss.indexOf('.site-cursor {'), appCss.indexOf('.site-cursor.is-dark.is-lock'));
    for (const colour of ['#10202e', '#b8872e']) {
      expect(block).toContain(colour);
      expect(CURSOR_CSS).toContain(colour);
    }
    expect(appCss).toContain('.site-cursor.is-dark.is-lock .site-cursor-c { border-color: #e3bf6f; }');
    expect(CURSOR_CSS).toContain('.site-cursor.is-dark.is-lock .site-cursor-c{border-color:#e3bf6f}');
  });

  it('is valid script with no inline styles in markup', () => {
    expect(() => new Function(CURSOR_SCRIPT)).not.toThrow();
    // It follows the page's own script, which ends in `})()`: without the `;` the two become one call.
    expect(CURSOR_SCRIPT.startsWith(';')).toBe(true);
    expect(CURSOR_SCRIPT).not.toMatch(/style=/);
  });
});
