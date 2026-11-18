// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DARK, INTERACTIVE, LIGHT, NATIVE_ZONE } from './site-cursor';

afterEach(() => { document.body.innerHTML = ''; });

// happy-dom gives modules an http URL, so read the file by directory instead.
const css = readFileSync(resolve(import.meta.dirname, '../../app/globals.css'), 'utf8');

describe('viewfinder cursor', () => {
  it('hands back the system cursor on maps, the full-screen QR code, dialogs and popovers', () => {
    document.body.innerHTML = `
      <div class="leaflet-container"><div id="map-tile"></div></div>
      <div class="tk-projector"><button id="exit">Exit</button></div>
      <dialog open><button id="in-dialog">OK</button></dialog>
      <div popover><a id="in-popover" href="/x">x</a></div>
      <main><button id="page-button">Save</button></main>`;
    for (const id of ['map-tile', 'exit', 'in-dialog', 'in-popover']) expect(document.getElementById(id)!.closest(NATIVE_ZONE), id).not.toBeNull();
    expect(document.getElementById('page-button')!.closest(NATIVE_ZONE)).toBeNull();
  });

  it('never hides the system cursor where it cannot draw its own (CSS and script agree)', () => {
    const rule = /html\.cursor-on body \*:not\(([^)]*(?:\([^)]*\)[^)]*)*)\) \{ cursor: none !important; \}/.exec(css);
    expect(rule).not.toBeNull();
    const exceptions = rule![1]!.split(',').map((part) => part.trim());
    for (const selector of NATIVE_ZONE.split(',').map((part) => part.trim())) {
      expect(exceptions, selector).toContain(selector);
      expect(exceptions, `${selector} *`).toContain(`${selector} *`);
    }
  });

  it('resets the inherited cursor in those places, so plain text in a dialog still shows one', () => {
    // .leaflet-container is left out on purpose: Leaflet sets its own grab hand.
    expect(css).toContain(':where(html.cursor-on) :where(dialog, [popover], .tk-projector, [data-cursor="native"]) { cursor: auto; }');
  });

  it('turns white on the navy surfaces of the workspaces', () => {
    document.body.innerHTML = `
      <section class="ds-paper"><span id="hero">12</span></section>
      <div class="ui-toast"><span id="toast">Saved</span></div>
      <div class="ui-status-notice" data-tone="maintenance"><span id="maint">Planned</span></div>
      <div class="ui-status-notice" data-tone="incident"><span id="incident">Problem</span></div>`;
    for (const id of ['hero', 'toast', 'maint']) expect(document.getElementById(id)!.closest(DARK), id).not.toBeNull();
    expect(document.getElementById('incident')!.closest(DARK)).toBeNull();
  });

  it('is white in the navy sidebar, but dark on the current-page tab and the account menu inside it', () => {
    document.body.innerHTML = `
      <aside class="ap-side">
        <a class="ap-nav-link" href="/a" id="link">Sessions</a>
        <a class="ap-nav-link is-active" href="/b" id="current"><span id="current-label">Registers</span></a>
        <div class="account-menu"><div class="account-menu-panel"><a href="/account" id="menu-item">Account</a></div></div>
      </aside>`;
    const isDark = (id: string) => {
      const element = document.getElementById(id)!;
      const dark = element.closest(DARK);
      const light = dark ? element.closest(LIGHT) : null;
      return Boolean(dark && !(light && dark.contains(light)));
    };
    expect(isDark('link')).toBe(true);
    expect(isDark('current-label')).toBe(false);
    expect(isDark('menu-item')).toBe(false);
  });

  it('locks on to checkboxes, radios, menu items and options as well as links and buttons', () => {
    document.body.innerHTML = `
      <input id="check" type="checkbox"><input id="radio" type="radio">
      <div role="menuitem" id="menuitem">Rename</div><div role="option" id="option">CSC 201</div>
      <input id="text" type="text">`;
    for (const id of ['check', 'radio', 'menuitem', 'option']) expect(document.getElementById(id)!.matches(INTERACTIVE), id).toBe(true);
    expect(document.getElementById('text')!.matches(INTERACTIVE)).toBe(false);
  });
});
