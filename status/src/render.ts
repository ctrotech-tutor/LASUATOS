import { currentStage, endedAt, STAGE_LABEL, type Incident, type Stage } from './incidents.ts';
import { escapeHtml as e, markdown } from './markdown.ts';
import { COMPONENTS, duration, WAT_OFFSET_MS, watDay, type ComponentId } from './model.ts';
import { barState, DAYS_SHOWN, type ComponentSummary, type DayBar, type Shown, type Summary } from './summary.ts';

/**
 * The status page, rendered on the server as plain HTML: it works without JavaScript,
 * loads fast on a weak connection and has no third-party scripts, fonts or trackers.
 * A small inline script only refreshes the page when the checker has news.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function watDate(at: number, withYear = false): string {
  const date = new Date(at + WAT_OFFSET_MS);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}${withYear ? ` ${date.getUTCFullYear()}` : ''}`;
}

export function watTime(at: number): string {
  return `${new Date(at + WAT_OFFSET_MS).toISOString().slice(11, 16)} WAT`;
}

function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function when(at: number, now: number): string {
  return watDay(at) === watDay(now) ? `today, ${watTime(at)}` : `${watDate(at, watDay(at).slice(0, 4) !== watDay(now).slice(0, 4))}, ${watTime(at)}`;
}

const STATE_TEXT: Record<Shown, string> = {
  operational: 'Working',
  degraded: 'Slow or failing at times',
  down: 'Not working',
  maintenance: 'Under maintenance',
};

const OVERALL: Record<Summary['overall'], { title: string; text: string }> = {
  operational: { title: 'Everything is working', text: 'All parts of LASUATOS are working normally.' },
  degraded: { title: 'Some things are slow or failing', text: 'Part of LASUATOS is having problems. Details below.' },
  down: { title: 'LASUATOS is having a major problem', text: 'Some things are not working. We are on it; details below.' },
  maintenance: { title: 'Maintenance in progress', text: 'Part of LASUATOS is being worked on. Details below.' },
};

const ICON = {
  operational: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m7.5 12.2 3 3 6-6.4" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  degraded: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 7v6.2M12 16.6v.4" fill="none" stroke-width="2.4" stroke-linecap="round"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m8.5 8.5 7 7m0-7-7 7" fill="none" stroke-width="2.4" stroke-linecap="round"/></svg>',
  maintenance: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M14.6 7.3a3.3 3.3 0 0 0-4.3 4.2l-3 3a1.2 1.2 0 0 0 1.7 1.7l3-3a3.3 3.3 0 0 0 4.2-4.3l-1.9 1.9-1.6-.1-.1-1.6Z" fill="none" stroke-width="1.6" stroke-linejoin="round"/></svg>',
};

const LOGO = '<svg viewBox="0 0 48 48" aria-hidden="true" class="logo"><rect x="1" y="1" width="46" height="46" rx="14" fill="#153B5B"/><path d="M12.5 35V18.5a6 6 0 0 1 6-6h9.2a6 6 0 0 1 4.24 1.76l3.56 3.56a6 6 0 0 1 1.76 4.24V35" stroke="#F7F8F4" stroke-width="2.2" stroke-linecap="round" fill="none"/><path d="M18.5 35V25h12v10" stroke="#F7F8F4" stroke-width="2.2" stroke-linejoin="round" fill="none"/><path d="m21.5 20.5 2.4 2.4 5-5.2" stroke="#D8B15C" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="34.5" cy="12.5" r="2.3" fill="#D8B15C"/></svg>';

export const FAVICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect x="1" y="1" width="46" height="46" rx="14" fill="#153B5B"/><path d="M12.5 35V18.5a6 6 0 0 1 6-6h9.2a6 6 0 0 1 4.24 1.76l3.56 3.56a6 6 0 0 1 1.76 4.24V35" stroke="#F7F8F4" stroke-width="2.2" stroke-linecap="round" fill="none"/><path d="M18.5 35V25h12v10" stroke="#F7F8F4" stroke-width="2.2" stroke-linejoin="round" fill="none"/><path d="m21.5 20.5 2.4 2.4 5-5.2" stroke="#D8B15C" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="34.5" cy="12.5" r="2.3" fill="#D8B15C"/></svg>';

const CSS = `
:root{--navy:#153b5b;--gold:#d8b15c;--bg:#f2f3ee;--surface:#fff;--sunken:#f6f7f3;--label:#10202e;--label2:#4b5965;--label3:#6b7680;--sep:rgb(16 32 46/11%);--ok:#1f8a5b;--ok-soft:#e4f1ea;--ok-ink:#17633f;--warn:#d39a1c;--warn-soft:#faf0da;--warn-ink:#85570a;--bad:#c8372d;--bad-soft:#fbe9e7;--bad-ink:#b0281f;--maint:#2f6fae;--maint-soft:#e5eef8;--maint-ink:#245a8f;--none:#d9dcd6;--radius:18px;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0b1620;--surface:#13212d;--sunken:#0f1c27;--label:#eef2f5;--label2:#b3bfc9;--label3:#8796a2;--sep:rgb(238 242 245/12%);--ok:#3fb97f;--ok-soft:rgb(63 185 127/14%);--ok-ink:#7fd6a9;--warn:#e7b443;--warn-soft:rgb(231 180 67/15%);--warn-ink:#f0c76a;--bad:#ef6a5f;--bad-soft:rgb(239 106 95/15%);--bad-ink:#f59a92;--maint:#5b9be0;--maint-soft:rgb(91 155 224/15%);--maint-ink:#9cc3ee;--none:#2a3a47}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--label);font:16px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
a{color:inherit}a:focus-visible,summary:focus-visible{outline:3px solid rgb(216 177 92/70%);outline-offset:2px;border-radius:6px}
.wrap{max-width:860px;margin:0 auto;padding:0 16px}
header.top{background:var(--navy);color:#f7f8f4}
header.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:64px}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;font-weight:700;letter-spacing:-.01em;font-size:18px}
.brand small{display:block;font-weight:500;font-size:12px;opacity:.75;letter-spacing:.02em}
.logo{width:34px;height:34px;flex:none}.top .logo rect{stroke:rgb(255 255 255/28%);stroke-width:1.5}
.go{font-size:14px;font-weight:600;text-decoration:none;padding:8px 12px;border-radius:999px;background:rgb(255 255 255/12%);white-space:nowrap}
.go:hover{background:rgb(255 255 255/20%)}
main.wrap{padding:20px 16px 40px}
.hero{display:flex;gap:14px;align-items:flex-start;padding:18px;border-radius:var(--radius);margin-bottom:16px;border:1px solid var(--sep)}
.hero svg{width:30px;height:30px;flex:none;margin-top:2px}
.hero h1{margin:0;font-size:22px;line-height:1.2;letter-spacing:-.02em}
.hero p{margin:4px 0 0;color:var(--label2);font-size:15px}
.hero .meta{font-size:13px;color:var(--label3);margin-top:8px}
.s-operational{--c:var(--ok);--soft:var(--ok-soft);--ink:var(--ok-ink)}
.s-degraded{--c:var(--warn);--soft:var(--warn-soft);--ink:var(--warn-ink)}
.s-down{--c:var(--bad);--soft:var(--bad-soft);--ink:var(--bad-ink)}
.s-maintenance{--c:var(--maint);--soft:var(--maint-soft);--ink:var(--maint-ink)}
.hero{background:var(--soft)}.hero svg circle{fill:var(--c)}.hero svg path{stroke:#fff}.hero svg path[fill="none"]{stroke:#fff}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.1em;color:var(--label3);margin:28px 4px 10px;font-weight:700}
.card{background:var(--surface);border:1px solid var(--sep);border-radius:var(--radius)}
.incident{padding:16px 16px 14px;margin-bottom:12px;border-left:5px solid var(--c)}
.incident h3{margin:0;font-size:17px;line-height:1.3;letter-spacing:-.01em}
.incident h3 a{text-decoration:none}.incident h3 a:hover{text-decoration:underline}
.badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;letter-spacing:.02em;padding:3px 9px;border-radius:999px;background:var(--soft);color:var(--ink);white-space:nowrap}
.badge::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--c)}
.row{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.update{margin-top:10px;color:var(--label2);font-size:15px}
.update p{margin:0 0 6px}.update ul{margin:4px 0 6px;padding-left:20px}
.update code{font:13px ui-monospace,Menlo,Consolas,monospace;background:var(--sunken);padding:1px 5px;border-radius:5px}
.small{font-size:13px;color:var(--label3)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.chip{font-size:12px;padding:2px 8px;border-radius:999px;background:var(--sunken);border:1px solid var(--sep);color:var(--label2)}
.parts .part{padding:14px 16px;border-top:1px solid var(--sep)}.parts .part:first-child{border-top:0}
.part .name{font-weight:650;font-size:16px}
.part .hint{font-size:13px;color:var(--label3);margin-top:1px}
.state{font-size:14px;font-weight:650;color:var(--ink);display:flex;align-items:center;gap:6px;white-space:nowrap}
.state svg{width:18px;height:18px}.state svg circle{fill:var(--c)}.state svg path{stroke:#fff}
.bars{display:flex;gap:2px;height:30px;margin-top:12px}
.bars span{flex:1;border-radius:3px;background:var(--none);min-width:2px}
.bars .b-operational{background:var(--ok)}.bars .b-degraded{background:var(--warn)}.bars .b-down{background:var(--bad)}.bars .b-maintenance{background:var(--maint)}
.bars span:hover{opacity:.7}
.axis{display:flex;justify-content:space-between;font-size:12px;color:var(--label3);margin-top:6px;gap:8px}
.axis .up{font-weight:600;color:var(--label2)}
.d30{display:none}
@media (max-width:640px){.bars span:nth-child(-n+${DAYS_SHOWN - 30}){display:none}.d90{display:none}.d30{display:inline}.hero h1{font-size:20px}}
.legend{display:flex;flex-wrap:wrap;gap:14px;font-size:12px;color:var(--label3);margin:10px 4px 0}
.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.lat{padding:14px 16px;display:grid;gap:16px}
@media (min-width:700px){.lat{grid-template-columns:1fr 1fr}}
.lat h3{margin:0;font-size:15px}.lat .now{font-size:13px;color:var(--label3)}
.spark{width:100%;height:56px;margin-top:8px;display:block}
.spark path{fill:none;stroke:var(--navy);stroke-width:1.6;vector-effect:non-scaling-stroke}
@media (prefers-color-scheme:dark){.spark path{stroke:var(--gold)}}
.spark .area{fill:rgb(21 59 91/8%);stroke:none}
@media (prefers-color-scheme:dark){.spark .area{fill:rgb(216 177 92/10%)}}
.days .day{padding:12px 16px;border-top:1px solid var(--sep)}.days .day:first-child{border-top:0}
.day h3{margin:0 0 4px;font-size:14px;color:var(--label2)}
.day .none{font-size:14px;color:var(--label3)}
.past{margin:6px 0 2px}.past a{font-weight:650;text-decoration:none}.past a:hover{text-decoration:underline}
.past .small{margin-top:2px}
.timeline{padding:6px 16px}
.timeline .entry{display:grid;grid-template-columns:118px 1fr;gap:12px;padding:12px 0;border-top:1px solid var(--sep)}
.timeline .entry:first-child{border-top:0}
@media (max-width:520px){.timeline .entry{grid-template-columns:1fr;gap:4px}}
.timeline strong{font-size:14px}.timeline .update{margin-top:2px}
.more{display:inline-block;margin-top:12px;font-weight:650;font-size:15px}
footer{border-top:1px solid var(--sep);padding:20px 0 36px;font-size:13px;color:var(--label3)}
footer p{margin:0 0 8px}footer a{color:var(--label2)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;

function page(input: { title: string; description: string; body: string; nonce: string; target: string; refresh: boolean; canonical: string }): string {
  return `<!doctype html><html lang="en-NG"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${e(input.title)}</title><meta name="description" content="${e(input.description)}">
<meta name="theme-color" content="#153b5b"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/atom+xml" title="LASUATOS status updates" href="/feed.atom">
<link rel="canonical" href="${e(input.canonical)}">
<meta property="og:title" content="${e(input.title)}"><meta property="og:description" content="${e(input.description)}"><meta property="og:type" content="website">
<style>${CSS}</style></head><body>
<header class="top"><div class="wrap"><a class="brand" href="/">${LOGO}<span>LASUATOS<small>System status</small></span></a><a class="go" href="${e(input.target)}">Open LASUATOS ›</a></div></header>
<main class="wrap">${input.body}</main>
<footer><div class="wrap">
<p>This page runs separately from LASUATOS, on Cloudflare, so it stays up when LASUATOS is down. Each part is checked every minute; the database-backed checks run every few minutes (more often while something is wrong). Times are West Africa Time (WAT).</p>
<p>Follow updates: <a href="/feed.atom">Atom feed</a> · <a href="/api/summary.json">JSON</a> · <a href="/history">Incident history</a> · Questions: ask your HOC or class rep.</p>
</div></footer>
${input.refresh ? `<script nonce="${e(input.nonce)}">(()=>{let s=document.documentElement.dataset.gen;setInterval(async()=>{if(document.hidden)return;try{const r=await fetch('/api/summary.json',{cache:'no-store'});const j=await r.json();if(String(j.generatedAt)!==s)location.reload()}catch{}},60000)})()</script>` : ''}
</body></html>`;
}

function stateClass(state: Shown): string {
  return `s-${state}`;
}

function incidentClass(incident: Incident): string {
  return incident.kind === 'maintenance' ? 's-maintenance' : incident.impact === 'major' ? 's-down' : 's-degraded';
}

function stageBadge(stage: Stage, cls: string): string {
  const tone = stage === 'resolved' || stage === 'completed' ? 's-operational' : cls;
  return `<span class="badge ${tone}">${STAGE_LABEL[stage]}</span>`;
}

function componentChips(ids: readonly ComponentId[]): string {
  if (!ids.length) return '';
  return `<div class="chips">${ids.map((id) => `<span class="chip">${e(COMPONENTS.find((component) => component.id === id)?.name ?? id)}</span>`).join('')}</div>`;
}

function incidentCard(incident: Incident, now: number): string {
  const cls = incidentClass(incident);
  const latest = incident.updates[0];
  const stage = currentStage(incident, now);
  const timing = incident.kind === 'maintenance'
    ? `${incident.startsAt !== null ? `From ${when(incident.startsAt, now)}` : 'Started'}${incident.endsAt !== null ? ` until ${when(incident.endsAt, now)}` : ''}`
    : `Started ${when(incident.createdAt, now)} · ${duration(Math.max(1, Math.round((now - incident.createdAt) / 60_000)))} so far`;
  return `<article class="card incident ${cls}"><div class="row"><h3><a href="/incidents/${e(incident.id)}">${e(incident.title)}</a></h3>${stageBadge(stage, cls)}</div>
${latest ? `<div class="update">${markdown(latest.body)}</div><div class="small">${STAGE_LABEL[latest.stage]} · ${when(latest.at, now)}</div>` : ''}
<div class="small">${e(timing)}</div>${componentChips(incident.components)}</article>`;
}

function barTitle(bar: DayBar): string {
  const state = barState(bar);
  if (state === 'none') return `${dayLabel(bar.day)}: no data`;
  const parts: string[] = [];
  if (bar.down) parts.push(`not working ${duration(bar.down)}`);
  if (bar.degraded) parts.push(`slow ${duration(bar.degraded)}`);
  if (bar.maint) parts.push(`maintenance ${duration(bar.maint)}`);
  return `${dayLabel(bar.day)}: ${parts.length ? parts.join(', ') : 'no problems'}`;
}

export function percent(value: number | null): string {
  if (value === null) return 'No data yet';
  const pct = value * 100;
  const text = pct >= 99.995 ? '100' : pct >= 99 ? pct.toFixed(2) : pct.toFixed(1);
  return `${text}% uptime`;
}

function componentRow(component: ComponentSummary, now: number): string {
  const cls = stateClass(component.state);
  const bad = component.days.filter((bar) => barState(bar) === 'down' || barState(bar) === 'degraded').length;
  const sinceText = component.state !== 'operational' && component.since ? ` since ${when(component.since, now)}` : '';
  return `<div class="part ${cls}"><div class="row"><div><div class="name">${e(component.name)}</div><div class="hint">${e(component.hint)}</div></div>
<div class="state">${ICON[component.state]}<span>${STATE_TEXT[component.state]}<span class="sr">${e(sinceText)}</span></span></div></div>
<div class="bars" role="img" aria-label="${e(`${component.name}: ${percent(component.uptime)} over ${DAYS_SHOWN} days, ${bad} ${bad === 1 ? 'day' : 'days'} with problems`)}">${component.days.map((bar) => {
    const state = barState(bar);
    return `<span class="b-${state}" title="${e(barTitle(bar))}"></span>`;
  }).join('')}</div>
<div class="axis"><span><span class="d90">${DAYS_SHOWN} days ago</span><span class="d30">30 days ago</span></span><span class="up"><span class="d90">${percent(component.uptime)}</span><span class="d30">${percent(component.uptime30)}</span></span><span>Today</span></div></div>`;
}

function spark(values: ReadonlyArray<number | null>): { svg: string; latest: number | null; average: number | null } {
  const present = values.filter((value): value is number => value !== null);
  if (!present.length) return { svg: '<p class="small">No measurements yet.</p>', latest: null, average: null };
  const sorted = [...present].sort((a, b) => a - b);
  const top = Math.max(400, sorted[Math.floor(sorted.length * 0.98)] ?? sorted.at(-1)!) * 1.1;
  const width = values.length - 1;
  let line = '';
  let area = '';
  let open = false;
  values.forEach((value, index) => {
    if (value === null) {
      if (open) area += `L${index - 1} 50Z`;
      open = false;
      return;
    }
    const y = (50 - (Math.min(value, top) / top) * 46).toFixed(1);
    line += `${open ? 'L' : 'M'}${index} ${y}`;
    area += open ? `L${index} ${y}` : `M${index} 50L${index} ${y}`;
    open = true;
  });
  if (open) area += `L${values.length - 1} 50Z`;
  const latest = [...values].reverse().find((value): value is number => value !== null) ?? null;
  const average = Math.round(present.reduce((sum, value) => sum + value, 0) / present.length);
  return {
    svg: `<svg class="spark" viewBox="0 0 ${width} 50" preserveAspectRatio="none" role="img" aria-label="Response time over the last 24 hours, average ${average} milliseconds"><path class="area" d="${area}"/><path d="${line}"/></svg>`,
    latest,
    average,
  };
}

function latencySection(summary: Summary): string {
  const site = spark(summary.latency.site);
  const api = spark(summary.latency.api);
  const block = (title: string, data: ReturnType<typeof spark>) => `<div><div class="row"><h3>${title}</h3><span class="now">${data.latest !== null ? `now ${data.latest} ms · average ${data.average} ms` : ''}</span></div>${data.svg}<div class="axis"><span>24 hours ago</span><span>Now</span></div></div>`;
  return `<h2>Response time</h2><section class="card lat">${block('Website', site)}${block('Server (API)', api)}</section>`;
}

function pastDays(summary: Summary, now: number): string {
  const byDay = new Map<string, Incident[]>();
  for (const incident of summary.recent) {
    const day = watDay(endedAt(incident, now) ?? incident.createdAt);
    byDay.set(day, [...(byDay.get(day) ?? []), incident]);
  }
  const rows: string[] = [];
  for (let index = 0; index < 7; index += 1) {
    const day = watDay(now - index * 86_400_000);
    const list = byDay.get(day) ?? [];
    rows.push(`<div class="day"><h3>${dayLabel(day)}</h3>${list.length ? list.map((incident) => pastLine(incident, now)).join('') : '<div class="none">No incidents reported.</div>'}</div>`);
  }
  return `<h2>Past incidents</h2><section class="card days">${rows.join('')}</section><a class="more" href="/history">Incident history ›</a>`;
}

function pastLine(incident: Incident, now: number): string {
  const ended = endedAt(incident, now);
  const minutes = ended !== null ? Math.max(1, Math.round((ended - (incident.startsAt ?? incident.createdAt)) / 60_000)) : null;
  const latest = incident.updates[0];
  return `<div class="past ${incidentClass(incident)}"><a href="/incidents/${e(incident.id)}">${e(incident.title)}</a>
<div class="small">${incident.kind === 'maintenance' ? 'Maintenance' : incident.impact === 'major' ? 'Major outage' : 'Partial outage'}${minutes !== null ? ` · ${duration(minutes)}` : ''}${ended !== null ? ` · ended ${watTime(ended)}` : ''}${latest ? ` · ${e(plainShort(latest.body))}` : ''}</div></div>`;
}

function plainShort(text: string): string {
  const flat = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  return flat.length > 140 ? `${flat.slice(0, 137)}…` : flat;
}

export function renderHome(summary: Summary, options: { nonce: string; target: string; origin: string; now: number }): string {
  const { now } = options;
  const overall = OVERALL[summary.overall];
  const checked = summary.lastCheckAt
    ? `Last checked ${when(summary.lastCheckAt, now)}${now - summary.lastCheckAt > 10 * 60_000 ? ' (the checker is behind; the states below may be out of date)' : ''}`
    : 'Waiting for the first check…';
  const body = `<section class="hero ${stateClass(summary.overall)}" aria-live="polite">${ICON[summary.overall]}<div><h1>${overall.title}</h1><p>${overall.text}</p><p class="meta">${e(checked)}</p></div></section>
${summary.active.length ? `<h2>Now</h2>${summary.active.map((incident) => incidentCard(incident, now)).join('')}` : ''}
${summary.upcoming.length ? `<h2>Planned maintenance</h2>${summary.upcoming.map((incident) => incidentCard(incident, now)).join('')}` : ''}
<h2>Parts of LASUATOS</h2><section class="card parts">${summary.components.map((component) => componentRow(component, now)).join('')}</section>
<div class="legend" aria-hidden="true"><span><i style="background:var(--ok)"></i>Working</span><span><i style="background:var(--warn)"></i>Slow or failing at times</span><span><i style="background:var(--bad)"></i>Not working</span><span><i style="background:var(--maint)"></i>Maintenance</span><span><i style="background:var(--none)"></i>No data</span></div>
${latencySection(summary)}
${pastDays(summary, now)}`;
  return page({
    title: `LASUATOS status: ${overall.title}`,
    description: 'Is LASUATOS working? Live status of sign-in, attendance check-in, face check and emails, with incident updates.',
    body,
    nonce: options.nonce,
    target: options.target,
    refresh: true,
    canonical: `${options.origin}/`,
  }).replace('<html lang="en-NG">', `<html lang="en-NG" data-gen="${summary.generatedAt}">`);
}

export function renderIncident(incident: Incident, options: { nonce: string; target: string; origin: string; now: number }): string {
  const { now } = options;
  const cls = incidentClass(incident);
  const stage = currentStage(incident, now);
  const ended = endedAt(incident, now);
  const kind = incident.kind === 'maintenance' ? 'Planned maintenance' : incident.impact === 'major' ? 'Major outage' : 'Partial outage';
  const window = incident.kind === 'maintenance' && incident.startsAt !== null
    ? `<p class="small">Planned ${when(incident.startsAt, now)}${incident.endsAt !== null ? ` to ${when(incident.endsAt, now)}` : ''}.</p>` : '';
  const body = `<p class="small"><a href="/">‹ Back to status</a></p>
<section class="card incident ${cls}"><div class="row"><h1 style="margin:0;font-size:22px;line-height:1.25">${e(incident.title)}</h1>${stageBadge(stage, cls)}</div>
<p class="small">${kind} · started ${when(incident.startsAt ?? incident.createdAt, now)}${ended !== null ? ` · ended ${when(ended, now)} (${duration(Math.max(1, Math.round((ended - (incident.startsAt ?? incident.createdAt)) / 60_000)))})` : ''}</p>${window}${componentChips(incident.components)}</section>
<h2>Updates</h2><section class="card timeline">${incident.updates.map((update) => `<div class="entry"><div><strong>${STAGE_LABEL[update.stage]}</strong><div class="small">${when(update.at, now)}</div></div><div class="update">${markdown(update.body)}</div></div>`).join('')}</section>`;
  return page({ title: `${incident.title} · LASUATOS status`, description: `${kind}: ${incident.title}`, body, nonce: options.nonce, target: options.target, refresh: ended === null, canonical: `${options.origin}/incidents/${incident.id}` });
}

export function renderHistory(incidents: readonly Incident[], options: { nonce: string; target: string; origin: string; now: number }): string {
  const { now } = options;
  const months = new Map<string, Incident[]>();
  for (const incident of incidents) {
    const key = watDay(incident.startsAt ?? incident.createdAt).slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), incident]);
  }
  const sections = [...months.entries()].map(([month, list]) => {
    const [y, m] = month.split('-').map(Number) as [number, number];
    return `<h2>${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}</h2><section class="card days">${list.map((incident) => `<div class="day">${pastLine(incident, now)}<div class="small">${watDate(incident.startsAt ?? incident.createdAt, true)}</div></div>`).join('')}</section>`;
  }).join('');
  const body = `<p class="small"><a href="/">‹ Back to status</a></p><h1 style="font-size:24px;margin:8px 4px 0">Incident history</h1><p class="small" style="margin:4px 4px 0">Incidents and maintenance from the last 90 days.</p>${sections || '<section class="card days"><div class="day"><div class="none">No incidents in the last 90 days.</div></div></section>'}`;
  return page({ title: 'Incident history · LASUATOS status', description: 'Past LASUATOS incidents and maintenance.', body, nonce: options.nonce, target: options.target, refresh: false, canonical: `${options.origin}/history` });
}

export function renderNotFound(options: { nonce: string; target: string; origin: string }): string {
  return page({ title: 'Not found · LASUATOS status', description: 'Not found', body: '<section class="card" style="padding:20px"><h1 style="margin:0 0 6px;font-size:20px">Nothing here</h1><p class="small">That incident or page does not exist. <a href="/">See the current status</a>.</p></section>', nonce: options.nonce, target: options.target, refresh: false, canonical: `${options.origin}/` });
}

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
  const color = { operational: '#1f8a5b', degraded: '#c98a0c', down: '#c8372d', maintenance: '#2f6fae' }[overall];
  const left = 74;
  const right = 10 + text.length * 7;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${left + right}" height="20" role="img" aria-label="LASUATOS: ${text}"><title>LASUATOS: ${text}</title><rect width="${left}" height="20" rx="3" fill="#153b5b"/><rect x="${left - 3}" width="${right + 3}" height="20" rx="3" fill="${color}"/><rect x="${left - 3}" width="3" height="20" fill="${color}"/><g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11"><text x="8" y="14">LASUATOS</text><text x="${left + 5}" y="14">${text}</text></g></svg>`;
}
