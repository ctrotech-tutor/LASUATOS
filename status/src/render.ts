import { currentStage, endedAt, STAGE_LABEL, type Incident, type Stage } from './incidents.ts';
import { escapeHtml as e, markdown } from './markdown.ts';
import { COMPONENTS, duration, WAT_OFFSET_MS, watDay, type ComponentId } from './model.ts';
import { CURSOR_SCRIPT } from './cursor.ts';
import { CSS, PRELOAD_FONT } from './styles.ts';
import { barState, DAYS_SHOWN, type ComponentSummary, type DayBar, type Shown, type Summary } from './summary.ts';

/**
 * The status page, rendered on the server as plain HTML in LASUATOS's public-site design
 * (styles.ts). It works without JavaScript, loads fast on a weak connection and has no
 * third-party scripts, fonts or trackers. A small inline script adds the bar tooltips,
 * keeps "checked … ago" current and reloads the page when the checker has news.
 *
 * Words follow docs/design-system.md: sentence case, "Today" / "Yesterday" / "Mon, 16 Nov",
 * 24-hour Lagos times (WAT is said once per page, not after every time).
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type PageOptions = { nonce: string; target: string; origin: string; now: number };

// ── Dates and times (West Africa Time, no daylight saving) ─────────────────

/** "16 Nov" or "16 Nov 2026" (the feed and the history list). */
export function watDate(at: number, withYear = false): string {
  const date = new Date(at + WAT_OFFSET_MS);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}${withYear ? ` ${date.getUTCFullYear()}` : ''}`;
}

/** "14:30 WAT", for the feed, which is read outside the page. */
export function watTime(at: number): string {
  return `${clock(at)} WAT`;
}

function clock(at: number): string {
  return new Date(at + WAT_OFFSET_MS).toISOString().slice(11, 16);
}

/** "Today", "Yesterday", "Tomorrow", else "Mon, 16 Nov" (with the year when it differs). */
function dayName(day: string, now: number): string {
  const today = watDay(now);
  if (day === today) return 'Today';
  if (day === watDay(now - 86_400_000)) return 'Yesterday';
  if (day === watDay(now + 86_400_000)) return 'Tomorrow';
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${d} ${MONTHS[m - 1]}${String(y) !== today.slice(0, 4) ? ` ${y}` : ''}`;
}

/** "Today, 14:30" / "Mon, 16 Nov, 14:30". */
function when(at: number, now: number): string {
  return `${dayName(watDay(at), now)}, ${clock(at)}`;
}

/** The same inside a sentence: "today, 14:30". */
function whenIn(at: number, now: number): string {
  return when(at, now).replace(/^(Today|Yesterday|Tomorrow)/, (word) => word.toLowerCase());
}

/** Only the time when it is the same day as `from`, for the end of a window. */
function untilTime(at: number, from: number, now: number): string {
  return watDay(at) === watDay(from) ? clock(at) : whenIn(at, now);
}

function ago(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return 'less than a minute ago';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  return `at ${whenIn(at, now)}`;
}

function minutesBetween(from: number, to: number): number {
  return Math.max(1, Math.round((to - from) / 60_000));
}

// ── Words ──────────────────────────────────────────────────────────────────

const STATE_TEXT: Record<Shown, string> = {
  operational: 'Working',
  degraded: 'Slow or failing at times',
  down: 'Not working',
  maintenance: 'Under maintenance',
};

const BADGE_TEXT: Record<Shown, string> = {
  operational: 'Working',
  degraded: 'Slow or failing',
  down: 'Not working',
  maintenance: 'Maintenance',
};

const OVERALL: Record<Summary['overall'], { title: string; text: string }> = {
  operational: { title: 'Everything is working', text: 'All parts of LASUATOS are working normally.' },
  degraded: { title: 'Some things are slow or failing', text: 'Part of LASUATOS is having problems. What is affected, and what to do meanwhile, is below.' },
  down: { title: 'LASUATOS is having a major problem', text: 'Some things are not working. We are on it; what to do meanwhile is below.' },
  maintenance: { title: 'Maintenance in progress', text: 'Part of LASUATOS is being worked on. Details are below.' },
};

function kindOf(incident: Incident): string {
  return incident.kind === 'maintenance' ? 'Planned maintenance' : incident.impact === 'major' ? 'Major outage' : 'Partial outage';
}

function componentName(id: ComponentId): string {
  return COMPONENTS.find((component) => component.id === id)?.name ?? id;
}

// ── Icons (inline SVG, drawn on the 24 px grid like lucide in the app) ─────

const STATUS_ICON: Record<Shown, string> = {
  operational: '<path d="m7.6 12.3 3 3 5.9-6.3"/>',
  degraded: '<path d="M12 7.2v5.6M12 16.4v.3"/>',
  down: '<path d="m8.6 8.6 6.8 6.8m0-6.8-6.8 6.8"/>',
  maintenance: '<path d="M14.5 7.4a3.2 3.2 0 0 0-4.2 4.1l-3 3a1.2 1.2 0 0 0 1.7 1.7l3-3a3.2 3.2 0 0 0 4.1-4.2l-1.8 1.8-1.6-.1-.1-1.6Z" stroke-width="1.6"/>',
};

function statusIcon(state: Shown): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="var(--c)"/><g fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${STATUS_ICON[state]}</g></svg>`;
}

const icon = (paths: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const ARROW_UP_RIGHT = icon('<path d="M7 17 17 7M8 7h9v9"/>');
const CHEVRON_RIGHT = icon('<path d="m9 18 6-6-6-6"/>');
const CHEVRON_LEFT = icon('<path d="m15 18-6-6 6-6"/>');
const ARROW_RIGHT = icon('<path d="M5 12h14m-6-6 6 6-6 6"/>');
const RSS = icon('<path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>');
const SEARCH = icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>');

const MARK = '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="1" y="1" width="46" height="46" rx="14" fill="#153B5B"/><path d="M12.5 35V18.5a6 6 0 0 1 6-6h9.2a6 6 0 0 1 4.24 1.76l3.56 3.56a6 6 0 0 1 1.76 4.24V35" stroke="#F7F8F4" stroke-width="2.2" stroke-linecap="round" fill="none"/><path d="M18.5 35V25h12v10" stroke="#F7F8F4" stroke-width="2.2" stroke-linejoin="round" fill="none"/><path d="m21.5 20.5 2.4 2.4 5-5.2" stroke="#D8B15C" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="34.5" cy="12.5" r="2.3" fill="#D8B15C"/></svg>';

export const FAVICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect x="1" y="1" width="46" height="46" rx="14" fill="#153B5B"/><path d="M12.5 35V18.5a6 6 0 0 1 6-6h9.2a6 6 0 0 1 4.24 1.76l3.56 3.56a6 6 0 0 1 1.76 4.24V35" stroke="#F7F8F4" stroke-width="2.2" stroke-linecap="round" fill="none"/><path d="M18.5 35V25h12v10" stroke="#F7F8F4" stroke-width="2.2" stroke-linejoin="round" fill="none"/><path d="m21.5 20.5 2.4 2.4 5-5.2" stroke="#D8B15C" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="34.5" cy="12.5" r="2.3" fill="#D8B15C"/></svg>';

// ── Page frame ─────────────────────────────────────────────────────────────

/**
 * The browser side, kept small:
 * - the header gets its shadow once the page scrolls (as on the public site);
 * - "Checked … ago" stays true without a reload;
 * - the history bars get a tooltip on hover, tap or keyboard (the `title` stays as the
 *   no-JavaScript fallback until this takes it over);
 * - the home page reloads itself when the checker has published something new.
 */
function script(refresh: boolean): string {
  return `(()=>{const d=document,h=d.querySelector('.hd');const sc=()=>h&&h.classList.toggle('is-scrolled',scrollY>4);addEventListener('scroll',sc,{passive:true});sc();
const ago=t=>{const m=Math.round((Date.now()-t)/6e4);return m<1?'less than a minute ago':m===1?'1 minute ago':m<60?m+' minutes ago':null};
const tick=()=>d.querySelectorAll('[data-ago]').forEach(n=>{const s=ago(+n.dataset.ago);if(s)n.textContent=s});setInterval(tick,15e3);
const tip=d.createElement('div');tip.className='tip';tip.setAttribute('role','tooltip');tip.id='bar-tip';tip.setAttribute('aria-live','polite');tip.hidden=true;d.body.append(tip);let on=null;
d.querySelectorAll('.bars span[title]').forEach(b=>{b.dataset.tip=b.title;b.removeAttribute('title')});
const show=b=>{if(on)on.classList.remove('is-on');on=b||null;if(!b){tip.hidden=true;return}b.classList.add('is-on');const t=b.dataset.tip,i=t.indexOf(': '),x=d.createElement('b');x.textContent=i<0?t:t.slice(0,i);tip.replaceChildren(x,i<0?'':t.slice(i+2));tip.hidden=false;const r=b.getBoundingClientRect(),w=tip.offsetWidth,c=r.left+r.width/2,l=Math.max(w/2+8,Math.min(c,innerWidth-w/2-8));tip.style.left=l+scrollX+'px';tip.style.top=r.top+scrollY+'px';tip.style.setProperty('--arrow',(c-l+w/2)+'px')};
d.addEventListener('pointerover',e=>{const b=e.target.closest&&e.target.closest('.bars span');if(b||!e.target.closest('.tip'))show(b)});
d.addEventListener('pointerdown',e=>{const b=e.target.closest&&e.target.closest('.bars span');show(b)});
addEventListener('scroll',()=>on&&show(null),{passive:true});d.addEventListener('keydown',e=>{if(e.key==='Escape')show(null)});
d.querySelectorAll('.bars').forEach(g=>{g.addEventListener('keydown',e=>{const s=[...g.querySelectorAll('span')].filter(n=>n.offsetWidth);let i=s.indexOf(on);if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();i=i<0?s.length-1:Math.max(0,Math.min(s.length-1,i+(e.key==='ArrowLeft'?-1:1)));show(s[i])}});g.addEventListener('focus',()=>{const s=[...g.querySelectorAll('span')].filter(n=>n.offsetWidth);show(s[s.length-1])});g.addEventListener('blur',()=>show(null))});
${refresh ? `let g=d.documentElement.dataset.gen;setInterval(async()=>{if(d.hidden)return;try{const r=await fetch('/api/summary.json',{cache:'no-store'});const j=await r.json();if(String(j.generatedAt)!==g)location.reload()}catch{}},6e4);` : ''}})()`;
}

function page(input: { title: string; description: string; body: string; nonce: string; target: string; refresh: boolean; canonical: string; current: 'status' | 'history' | null; tone?: Shown; generatedAt?: number }): string {
  const target = e(input.target);
  const nav = (href: string, label: string, key: 'status' | 'history') => `<a href="${href}"${input.current === key ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<!doctype html><html lang="en-NG"${input.generatedAt !== undefined ? ` data-gen="${input.generatedAt}"` : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${e(input.title)}</title><meta name="description" content="${e(input.description)}">
<meta name="theme-color" content="#fbfbf8"><meta name="color-scheme" content="light"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="${PRELOAD_FONT}" as="font" type="font/woff2" crossorigin>
<link rel="alternate" type="application/atom+xml" title="LASUATOS status updates" href="/feed.atom">
<link rel="canonical" href="${e(input.canonical)}">
<meta property="og:site_name" content="LASUATOS status"><meta property="og:title" content="${e(input.title)}"><meta property="og:description" content="${e(input.description)}"><meta property="og:type" content="website"><meta property="og:url" content="${e(input.canonical)}">
<style nonce="${e(input.nonce)}">${CSS}</style></head><body>
<a class="skip" href="#main">Skip to content</a>
<header class="hd"><div class="hd-bar">
<a class="brand" href="/">${MARK}<span class="brand-copy"><strong>LASUATOS</strong><small>System status</small></span><span class="sr">, current status</span></a>
<nav class="hd-nav" aria-label="Status pages">${nav('/', 'Status', 'status')}${nav('/history', 'History', 'history')}</nav>
<a class="cta" href="${target}"><span class="cta-icon">${ARROW_UP_RIGHT}</span><span class="cta-long">Open LASUATOS</span><span class="cta-short">Open app</span></a>
</div></header>
<main id="main"${input.tone ? ` class="t-${input.tone}"` : ''}>${input.body}</main>
<footer class="ft">
<div class="ft-main">
<div class="ft-lead"><a class="brand" href="/">${MARK}<span class="brand-copy"><strong>LASUATOS</strong><small>System status</small></span></a>
<p>This page runs apart from LASUATOS, on another provider, so it keeps working when LASUATOS is down. Bookmark it for days when the app will not load.</p>
<div class="ft-actions"><a class="ft-btn gold" href="${target}">Open LASUATOS ${ARROW_UP_RIGHT}</a><a class="ft-btn" href="/feed.atom">${RSS} Follow updates</a></div></div>
<div class="ft-cols">
<div><h2>Status</h2><ul><li><a href="/">Current status</a></li><li><a href="/history">Incident history</a></li><li><a href="/feed.atom">Atom feed</a></li><li><a href="/api/status.json">Status as JSON</a></li></ul></div>
<div><h2>LASUATOS</h2><ul><li><a href="${target}">Open LASUATOS</a></li><li><a href="${target}/help">Help centre</a></li><li><a href="${target}/contact">Contact</a></li></ul></div>
<div class="ft-note"><h2>How it works</h2><p>Each part is checked from outside every minute; the deeper checks run every few minutes, and every minute while something is wrong. Problems open an incident by themselves.</p></div>
</div></div>
<p class="ft-word" aria-hidden="true">LASUATOS<span class="ft-dot"></span></p>
<div class="ft-bottom"><p>Times are West Africa Time (WAT).</p><p>Questions? Ask your HOC or class rep.</p></div>
</footer>
<script nonce="${e(input.nonce)}">${script(input.refresh)};
${CURSOR_SCRIPT}</script>
</body></html>`;
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function incidentTone(incident: Incident): Shown {
  return incident.kind === 'maintenance' ? 'maintenance' : incident.impact === 'major' ? 'down' : 'degraded';
}

function stageTone(stage: Stage, incident: Incident): Shown | 'neutral' {
  if (stage === 'resolved' || stage === 'completed') return 'operational';
  // Monitoring means a fix is in and being watched: calm blue, not the alarm colour.
  if (stage === 'scheduled' || stage === 'in_progress' || stage === 'monitoring') return 'maintenance';
  if (stage === 'update') return 'neutral';
  return incidentTone(incident);
}

function stageBadge(stage: Stage, incident: Incident): string {
  const tone = stageTone(stage, incident);
  const live = stage !== 'resolved' && stage !== 'completed' && stage !== 'scheduled';
  return `<span class="badge t-${tone}${live ? ' badge-live' : ''}">${STAGE_LABEL[stage]}</span>`;
}

function chips(ids: readonly ComponentId[], label = 'Affects'): string {
  if (!ids.length) return '';
  return `<ul class="chips" aria-label="${label}">${ids.map((id) => `<li class="chip">${e(componentName(id))}</li>`).join('')}</ul>`;
}

function incidentCard(incident: Incident, now: number): string {
  const tone = incidentTone(incident);
  const latest = incident.updates[0];
  const stage = currentStage(incident, now);
  const timing = incident.kind === 'maintenance'
    ? incident.startsAt !== null
      ? `${incident.startsAt > now ? 'Planned for' : 'Started'} ${whenIn(incident.startsAt, now)}${incident.endsAt !== null ? ` to ${untilTime(incident.endsAt, incident.startsAt, now)}` : ''}`
      : `Started ${whenIn(incident.createdAt, now)}`
    : `Started ${whenIn(incident.createdAt, now)} · ${duration(minutesBetween(incident.createdAt, now))} so far`;
  const updated = latest && incident.updates.length > 1 ? ` · Updated ${whenIn(latest.at, now)}` : '';
  return `<article class="card inc t-${tone}"><div class="inc-top">${stageBadge(stage, incident)}<span class="inc-kind">${kindOf(incident)}</span></div>
<h3><a href="/incidents/${e(incident.id)}">${e(incident.title)}</a></h3>
${latest ? `<div class="prose">${markdown(latest.body)}</div>` : ''}
<p class="inc-meta">${e(timing)}${e(updated)}</p>
<div class="inc-foot">${chips(incident.components) || '<span></span>'}<a class="more" href="/incidents/${e(incident.id)}">${incident.updates.length > 1 ? `All ${incident.updates.length} updates` : 'Details'}${CHEVRON_RIGHT}<span class="sr">: ${e(incident.title)}</span></a></div></article>`;
}

function barTitle(bar: DayBar, now: number): string {
  const state = barState(bar);
  const [y, m, d] = bar.day.split('-').map(Number) as [number, number, number];
  const name = dayName(bar.day, now);
  const label = name === 'Today' || name === 'Yesterday' ? `${name}, ${d} ${MONTHS[m - 1]}` : `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${d} ${MONTHS[m - 1]} ${y}`;
  if (state === 'none') return `${label}: No data`;
  const parts: string[] = [];
  if (bar.down) parts.push(`Not working for ${duration(bar.down)}`);
  if (bar.degraded) parts.push(`Slow for ${duration(bar.degraded)}`);
  if (bar.maint) parts.push(`Maintenance for ${duration(bar.maint)}`);
  return `${label}: ${parts.length ? parts.join(' · ') : 'No problems'}`;
}

export function percent(value: number | null): string {
  if (value === null) return 'No data yet';
  const pct = value * 100;
  const text = pct >= 99.995 ? '100' : pct >= 99 ? pct.toFixed(2) : pct.toFixed(1);
  return `${text}% uptime`;
}

function componentRow(component: ComponentSummary, now: number, pending: boolean): string {
  const tone = component.state;
  const bad = component.days.filter((bar) => barState(bar) === 'down' || barState(bar) === 'degraded').length;
  const since = component.state !== 'operational' && component.since ? ` since ${whenIn(component.since, now)}` : '';
  const label = `${component.name}: ${percent(component.uptime)} over ${DAYS_SHOWN} days, ${bad} ${bad === 1 ? 'day' : 'days'} with problems. Use the arrow keys to read each day.`;
  return `<li class="part">
<div class="part-head"><h3>${e(component.name)}</h3>${pending && tone === 'operational'
    ? '<span class="badge t-neutral">Not checked yet</span>'
    : `<span class="badge t-${tone}${tone === 'down' || tone === 'degraded' ? ' badge-live' : ''}">${BADGE_TEXT[tone]}<span class="sr">: ${STATE_TEXT[tone]}${e(since)}</span></span>`}</div>
<p class="part-hint">${e(component.hint)}</p>
<div class="bars" tabindex="0" role="img" aria-label="${e(label)}" aria-describedby="bar-tip">${component.days.map((bar) => `<span class="b-${barState(bar)}" title="${e(barTitle(bar, now))}"></span>`).join('')}</div>
<div class="axis"><span><span class="d90">${DAYS_SHOWN} days ago</span><span class="d30">30 days ago</span></span><span class="num"><span class="d90">${percent(component.uptime)}</span><span class="d30">${percent(component.uptime30)}</span></span><span>Today</span></div>
</li>`;
}

function spark(values: ReadonlyArray<number | null>, label: string): { svg: string; latest: number | null; average: number | null } {
  const present = values.filter((value): value is number => value !== null);
  if (!present.length) return { svg: '<p class="empty-note">No measurements yet. They start with the first check.</p>', latest: null, average: null };
  const sorted = [...present].sort((a, b) => a - b);
  const top = Math.max(400, sorted[Math.floor(sorted.length * 0.98)] ?? sorted.at(-1)!) * 1.1;
  const width = Math.max(1, values.length - 1);
  const y = (value: number) => (60 - (Math.min(value, top) / top) * 54).toFixed(1);
  let line = '';
  let area = '';
  let open = false;
  values.forEach((value, index) => {
    if (value === null) {
      if (open) area += `L${index - 1} 60Z`;
      open = false;
      return;
    }
    line += `${open ? 'L' : 'M'}${index} ${y(value)}`;
    area += open ? `L${index} ${y(value)}` : `M${index} 60L${index} ${y(value)}`;
    open = true;
  });
  if (open) area += `L${values.length - 1} 60Z`;
  const latest = [...values].reverse().find((value): value is number => value !== null) ?? null;
  const average = Math.round(present.reduce((sum, value) => sum + value, 0) / present.length);
  return {
    svg: `<svg class="spark" viewBox="0 0 ${width} 60" preserveAspectRatio="none" role="img" aria-label="${e(label)} over the last 24 hours: average ${average} milliseconds, now ${latest} milliseconds"><defs><linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#153b5b" stop-opacity=".16"/><stop offset="1" stop-color="#153b5b" stop-opacity="0"/></linearGradient></defs><path class="area" d="${area}"/><line class="avg" x1="0" x2="${width}" y1="${y(average)}" y2="${y(average)}"/><path class="line" d="${line}"/></svg>`,
    latest,
    average,
  };
}

function latencySection(summary: Summary): string {
  const block = (title: string, values: ReadonlyArray<number | null>) => {
    const data = spark(values, title);
    return `<div class="card lat"><div class="lat-head"><h3>${title}</h3>${data.average !== null ? `<span class="lat-avg num">Average ${data.average} ms</span>` : ''}</div>
${data.latest !== null ? `<p class="lat-now"><strong class="num">${data.latest}</strong>ms now</p>` : ''}${data.svg}${data.latest !== null ? '<div class="axis"><span>24 hours ago</span><span>Dashed line: average</span><span>Now</span></div>' : ''}</div>`;
  };
  return `<section class="sec" aria-labelledby="lat-title"><div class="sec-head"><h2 id="lat-title">Response time</h2><span class="sec-aside">How long LASUATOS takes to answer</span></div><div class="lat-grid">${block('Website', summary.latency.site)}${block('Server', summary.latency.api)}</div></section>`;
}

function pastRow(incident: Incident, now: number, withDate = false): string {
  const ended = endedAt(incident, now);
  const start = incident.startsAt ?? incident.createdAt;
  const latest = incident.updates[0];
  const meta = [
    kindOf(incident).replace('Planned maintenance', 'Maintenance'),
    withDate ? watDate(start, watDay(start).slice(0, 4) !== watDay(now).slice(0, 4)) : null,
    ended !== null ? `${clock(start)}–${clock(ended)}` : null,
    ended !== null ? duration(minutesBetween(start, ended)) : null,
  ].filter(Boolean).join(' · ');
  return `<a class="past t-${incidentTone(incident)}" href="/incidents/${e(incident.id)}"><span class="past-dot" aria-hidden="true"></span><span class="past-body"><span class="past-title">${e(incident.title)}</span><span class="past-meta">${e(meta)}</span>${latest ? `<span class="past-text">${e(plainShort(latest.body))}</span>` : ''}</span>${CHEVRON_RIGHT.replace('<svg', '<svg class="past-chev"')}</a>`;
}

function pastDays(summary: Summary, now: number): string {
  const byDay = new Map<string, Incident[]>();
  for (const incident of summary.recent) {
    const day = watDay(endedAt(incident, now) ?? incident.createdAt);
    byDay.set(day, [...(byDay.get(day) ?? []), incident]);
  }
  const rows: string[] = [];
  for (let index = 0; index < 7; index += 1) {
    const at = now - index * 86_400_000;
    const day = watDay(at);
    const list = byDay.get(day) ?? [];
    const name = dayName(day, now);
    const date = name === 'Today' || name === 'Yesterday' ? `<small>${watDate(at)}</small>` : '';
    rows.push(`<li class="day"><h3 class="day-date">${name}${date}</h3><div>${list.length ? list.map((incident) => pastRow(incident, now)).join('') : '<p class="day-none">No incidents</p>'}</div></li>`);
  }
  return `<section class="sec" aria-labelledby="past-title"><div class="sec-head"><h2 id="past-title">Past incidents</h2><span class="sec-aside">Last 7 days</span></div><ol class="card days">${rows.join('')}</ol>
<div class="list-more"><a class="btn" href="/history">Incident history ${ARROW_RIGHT}</a></div></section>`;
}

function plainShort(text: string): string {
  const flat = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  return flat.length > 160 ? `${flat.slice(0, 157)}…` : flat;
}

function legend(): string {
  const item = (tone: string, text: string) => `<li class="t-${tone}"><i></i>${text}</li>`;
  return `<ul class="legend" aria-label="What the colours mean">${item('operational', 'Working')}${item('degraded', 'Slow or failing at times')}${item('down', 'Not working')}${item('maintenance', 'Maintenance')}${item('none', 'No data')}</ul>`;
}

// ── Pages ──────────────────────────────────────────────────────────────────

export function renderHome(summary: Summary, options: PageOptions): string {
  const { now } = options;
  const overall = OVERALL[summary.overall];
  const stale = summary.lastCheckAt !== null && now - summary.lastCheckAt > 10 * 60_000;
  const live = summary.lastCheckAt === null
    ? '<p class="live t-neutral"><span class="pulse" aria-hidden="true"></span>Waiting for the first check…</p>'
    : `<p class="live ${stale ? 't-degraded' : 't-operational'}" title="${e(when(summary.lastCheckAt, now))} WAT"><span class="pulse" aria-hidden="true"></span><span>Checked <span data-ago="${summary.lastCheckAt}">${ago(summary.lastCheckAt, now)}</span>${stale ? ' · the checker is behind, so this may be out of date' : ' · every minute'}</span></p>`;
  const hidden = COMPONENTS.length - summary.components.length;
  // Before the first check there is nothing to say yet: no green ticks that were never earned.
  // A reported incident always wins, so this only applies while everything still looks fine.
  const pending = summary.lastCheckAt === null && summary.overall === 'operational';
  const tone: Shown | 'neutral' = pending ? 'neutral' : summary.overall;
  const heading = pending ? { title: 'Checking LASUATOS…', text: 'The first check runs within a minute. This page updates by itself.' } : overall;
  const body = `<div class="wrap">
<section class="hero t-${tone}" aria-live="polite"><span class="hero-icon">${pending ? statusIcon('operational').replace('<path d="m7.6 12.3 3 3 5.9-6.3"/>', '<path d="M8 12h.01M12 12h.01M16 12h.01" stroke-width="3"/>') : statusIcon(summary.overall)}</span><p class="kicker">LASUATOS status</p><h1>${heading.title}</h1><p class="lede">${heading.text}</p>${live}</section>
${summary.active.length ? `<section class="sec" aria-labelledby="now-title"><div class="sec-head"><h2 id="now-title">Happening now</h2><span class="sec-aside">${summary.active.length === 1 ? '1 incident' : `${summary.active.length} incidents`}</span></div>${summary.active.map((incident) => incidentCard(incident, now)).join('')}</section>` : ''}
${summary.upcoming.length ? `<section class="sec" aria-labelledby="plan-title"><div class="sec-head"><h2 id="plan-title">Planned maintenance</h2></div>${summary.upcoming.map((incident) => incidentCard(incident, now)).join('')}</section>` : ''}
<section class="sec" aria-labelledby="parts-title"><div class="sec-head"><h2 id="parts-title">Parts of LASUATOS</h2><span class="sec-aside"><span class="d90">Last ${DAYS_SHOWN} days</span><span class="d30">Last 30 days</span></span></div>
<ul class="card parts" role="list">${summary.components.map((component) => componentRow(component, now, pending)).join('')}</ul>${legend()}
${hidden > 0 ? `<p class="foot">${hidden === 1 ? 'One part is' : `${hidden} parts are`} turned off in LASUATOS at the moment, so ${hidden === 1 ? 'it is' : 'they are'} not shown.</p>` : ''}</section>
${latencySection(summary)}
${pastDays(summary, now)}
</div>`;
  return page({
    title: `LASUATOS status: ${heading.title}`,
    description: 'Is LASUATOS working? Live status of sign-in, attendance check-in, face check and emails, with incident updates.',
    body,
    nonce: options.nonce,
    target: options.target,
    refresh: true,
    canonical: `${options.origin}/`,
    current: 'status',
    generatedAt: summary.generatedAt,
  });
}

export function renderIncident(incident: Incident, options: PageOptions): string {
  const { now } = options;
  const tone = incidentTone(incident);
  const stage = currentStage(incident, now);
  const ended = endedAt(incident, now);
  const start = incident.startsAt ?? incident.createdAt;
  const upcoming = incident.kind === 'maintenance' && incident.startsAt !== null && incident.startsAt > now;
  const facts: string[] = [];
  if (incident.kind === 'maintenance' && incident.startsAt !== null) {
    facts.push(`<div><dt>${upcoming ? 'Planned for' : 'Window'}</dt><dd>${e(when(incident.startsAt, now))}${incident.endsAt !== null ? ` to ${e(untilTime(incident.endsAt, incident.startsAt, now))}` : ''}</dd></div>`);
  } else {
    facts.push(`<div><dt>Started</dt><dd>${e(when(start, now))}</dd></div>`);
  }
  if (ended !== null) facts.push(`<div><dt>${incident.kind === 'maintenance' ? 'Finished' : 'Fixed'}</dt><dd>${e(when(ended, now))}</dd></div>`);
  if (!upcoming) facts.push(`<div><dt>${ended !== null ? 'Lasted' : 'So far'}</dt><dd>${duration(minutesBetween(start, ended ?? now))}</dd></div>`);
  if (incident.components.length) facts.push(`<div class="wide"><dt>Affects</dt><dd>${chips(incident.components)}</dd></div>`);
  const updates = incident.updates.map((update) => `<li class="tl-item t-${stageTone(update.stage, incident)}"><span class="tl-dot" aria-hidden="true"></span><div class="tl-head"><span class="tl-stage">${STAGE_LABEL[update.stage]}</span><time class="tl-time" datetime="${new Date(update.at).toISOString()}">${e(when(update.at, now))}</time></div><div class="prose">${markdown(update.body)}</div></li>`).join('');
  const body = `<div class="wrap page"><a class="back" href="/">${CHEVRON_LEFT}Status</a>
<header class="ph t-${tone}"><p class="kicker">${kindOf(incident)}</p><h1>${e(incident.title)}</h1><div class="ph-badges">${stageBadge(stage, incident)}${incident.automatic ? '<span class="badge t-neutral">Found by the checker</span>' : ''}</div></header>
<dl class="card facts">${facts.join('')}</dl>
<section class="sec" aria-labelledby="updates-title"><div class="sec-head"><h2 id="updates-title">Updates</h2><span class="sec-aside">Newest first · times in WAT</span></div><ol class="card tl">${updates || '<li class="tl-item"><p class="day-none">No updates yet.</p></li>'}</ol></section>
</div>`;
  return page({ title: `${incident.title} · LASUATOS status`, description: `${kindOf(incident)}: ${incident.title}`, body, nonce: options.nonce, target: options.target, refresh: ended === null, canonical: `${options.origin}/incidents/${incident.id}`, current: null, tone });
}

export function renderHistory(incidents: readonly Incident[], options: PageOptions): string {
  const { now } = options;
  const months = new Map<string, Incident[]>();
  for (const incident of incidents) {
    const key = watDay(incident.startsAt ?? incident.createdAt).slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), incident]);
  }
  const sections = [...months.entries()].map(([month, list]) => {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const id = `m-${month}`;
    return `<section class="sec" aria-labelledby="${id}"><div class="sec-head"><h2 id="${id}">${MONTHS_LONG[m - 1]} ${y}</h2><span class="sec-aside">${list.length === 1 ? '1 entry' : `${list.length} entries`}</span></div><ol class="card days">${list.map((incident) => `<li class="day day-one">${pastRow(incident, now, true)}</li>`).join('')}</ol></section>`;
  }).join('');
  const empty = `<div class="card empty"><span class="empty-icon">${statusIcon('operational').replace('fill="var(--c)"', 'fill="var(--ok)"')}</span><h2>No incidents in the last 90 days</h2><p>Nothing has gone wrong that students would have noticed. Problems will show here as they are fixed.</p><a class="btn" href="/">See the current status</a></div>`;
  const body = `<div class="wrap page"><a class="back" href="/">${CHEVRON_LEFT}Status</a>
<header class="ph"><p class="kicker">LASUATOS status</p><h1>Incident history</h1><p class="lede">Incidents and maintenance from the last 90 days, newest first.</p></header>
${sections || empty}</div>`;
  return page({ title: 'Incident history · LASUATOS status', description: 'Past LASUATOS incidents and maintenance.', body, nonce: options.nonce, target: options.target, refresh: false, canonical: `${options.origin}/history`, current: 'history' });
}

export function renderNotFound(options: Omit<PageOptions, 'now'>): string {
  const body = `<div class="wrap page"><div class="card empty"><span class="empty-icon">${SEARCH}</span><h1 class="sr">Not found</h1><h2>Nothing here</h2><p>That incident or page does not exist. It may have been removed, or the link is wrong.</p><a class="btn btn-filled" href="/">See the current status</a></div></div>`;
  return page({ title: 'Not found · LASUATOS status', description: 'Not found', body, nonce: options.nonce, target: options.target, refresh: false, canonical: `${options.origin}/`, current: null });
}

// ── Feed and badge (not HTML pages) ────────────────────────────────────────

export function renderFeed(incidents: readonly Incident[], origin: string, now: number): string {
  const xml = (text: string) => text.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
  const updated = incidents.reduce((latest, incident) => Math.max(latest, incident.updates[0]?.at ?? incident.createdAt), 0) || now;
  const entries = incidents.slice(0, 30).map((incident) => {
    const at = incident.updates[0]?.at ?? incident.createdAt;
    const content = incident.updates.map((update) => `<p><strong>${STAGE_LABEL[update.stage]}</strong> (${watDate(update.at, true)}, ${watTime(update.at)})</p>${markdown(update.body)}`).join('');
    return `<entry><id>${xml(`${origin}/incidents/${incident.id}`)}</id><title>${xml(`${STAGE_LABEL[currentStage(incident, now)]}: ${incident.title}`)}</title><link href="${xml(`${origin}/incidents/${incident.id}`)}"/><published>${new Date(incident.createdAt).toISOString()}</published><updated>${new Date(at).toISOString()}</updated><content type="html">${xml(content)}</content></entry>`;
  }).join('');
  return `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>${xml(`${origin}/`)}</id><title>LASUATOS status</title><subtitle>Incidents and maintenance for LASUATOS</subtitle><link href="${xml(`${origin}/`)}"/><link rel="self" href="${xml(`${origin}/feed.atom`)}"/><updated>${new Date(updated).toISOString()}</updated><author><name>LASUATOS</name></author>${entries}</feed>`;
}

export function renderBadge(overall: Summary['overall']): string {
  const text = { operational: 'working', degraded: 'degraded', down: 'outage', maintenance: 'maintenance' }[overall];
  const color = { operational: '#1f6b4a', degraded: '#a8740f', down: '#b0281f', maintenance: '#3e72a3' }[overall];
  const left = 74;
  const right = 10 + text.length * 7;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${left + right}" height="20" role="img" aria-label="LASUATOS: ${text}"><title>LASUATOS: ${text}</title><rect width="${left}" height="20" rx="3" fill="#153b5b"/><rect x="${left - 3}" width="${right + 3}" height="20" rx="3" fill="${color}"/><rect x="${left - 3}" width="3" height="20" fill="${color}"/><g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11"><text x="8" y="14">LASUATOS</text><text x="${left + 5}" y="14">${text}</text></g></svg>`;
}
