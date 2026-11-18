import { CURSOR_CSS } from './cursor.ts';
import { DAYS_SHOWN } from './summary.ts';

/**
 * The status page's styles: LASUATOS's public-site look (apps/web/app/tokens.css, the
 * `site-header` and `site-footer` in globals.css, and the `pg-` pages in pages.css),
 * restated here because this page must not load anything from LASUATOS. Keep the
 * values in step with those files. The fonts are the same files, served from /fonts.
 */

const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

/** The one font file every page needs at once (preloaded). */
export const PRELOAD_FONT = '/fonts/inter-5.3.0-latin.woff2';

const face = (family: string, file: string, range: string) =>
  `@font-face{font-family:"${family}";font-style:normal;font-display:swap;font-weight:200 800;src:url(/fonts/${file}) format("woff2-variations"),url(/fonts/${file}) format("woff2");unicode-range:${range}}`;

/** The paper grain of the public site (`--noise-ink` and `--noise-light` in globals.css). */
const NOISE_INK = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.06 0 0 0 0 0.13 0 0 0 0 0.18 2.4 0 0 0 -1.05'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;
const NOISE_LIGHT = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 2.4 0 0 0 -1.05'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

export const CSS = `
${face('Inter Variable', 'inter-5.3.0-latin.woff2', LATIN)}
${face('Inter Variable', 'inter-5.3.0-latin-ext.woff2', LATIN_EXT)}
${face('Plus Jakarta Sans Variable', 'jakarta-5.3.0-latin.woff2', LATIN)}
${face('Plus Jakarta Sans Variable', 'jakarta-5.3.0-latin-ext.woff2', LATIN_EXT)}
:root{
--navy:#153b5b;--navy-deep:#0c2236;--ochre:#c59a42;--gold:#d8b15c;--gold-ink:#87661f;--gold-light:#e3bf6f;
--paper:#fbfbf8;--surface:#fff;--sunken:#f6f7f3;--line:#e4e8e6;--sep:rgb(16 32 46/9%);
--label:#10202e;--label-2:#46586a;--label-3:#5c6872;--label-4:#8d989f;
--tint-soft:#e7eef4;--fill:rgb(118 120 128/12%);
--ok:#2b8a5e;--ok-ink:#1f6b4a;--ok-soft:#e4f1ea;--ok-ring:rgb(43 138 94/16%);
--warn:#d09424;--warn-ink:#85570a;--warn-soft:#faf0da;--warn-ring:rgb(208 148 36/20%);
--bad:#c8372d;--bad-ink:#b0281f;--bad-soft:#fbe9e7;--bad-ring:rgb(200 55 45/16%);
--maint:#3e72a3;--maint-ink:#153b5b;--maint-soft:#e7eef4;--maint-ring:rgb(62 114 163/16%);
--none:rgb(118 120 128/15%);
--font-text:"Inter Variable",Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
--font-display:"Plus Jakarta Sans Variable","Inter Variable",ui-sans-serif,system-ui,sans-serif;
--font-mono:ui-monospace,"SF Mono","Cascadia Mono",Menlo,Consolas,monospace;
--ease:cubic-bezier(.22,1,.36,1);
--shadow-1:0 1px 2px rgb(16 32 46/5%);
--shadow-2:0 1px 2px rgb(16 32 46/4%),0 8px 24px rgb(16 32 46/6%);
--text-body:16px;--text-callout:15px;--text-subhead:14px;--text-footnote:13px;--text-section:19px;
--gutter:clamp(16px,5vw,40px);
color-scheme:light;
}
@media (min-width:761px){:root{--text-body:15px;--text-callout:14px;--text-subhead:13.5px;--text-section:18px}}
@media (prefers-contrast:more){:root{--label-2:#34414c;--label-3:#45525c;--line:#c9d0cc;--sep:rgb(16 32 46/22%)}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;overflow-x:clip;scroll-padding-top:84px}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;overflow-x:clip;overflow-wrap:anywhere;background:var(--paper);color:var(--label);font-family:var(--font-text);font-feature-settings:"cv11","ss01";font-size:var(--text-body);line-height:1.5;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;-webkit-tap-highlight-color:transparent}
h1,h2,h3{overflow-wrap:break-word;margin:0}
a{color:inherit;text-decoration:none}
:focus-visible{outline:3px solid rgb(21 59 91/34%);outline-offset:2px;border-radius:6px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.skip{position:absolute;left:12px;top:-60px;z-index:60;padding:10px 14px;border-radius:12px;background:var(--navy);color:#fff;font-weight:650;transition:top 160ms var(--ease)}
.skip:focus{top:12px}
.num{font-variant-numeric:tabular-nums}
.wrap{width:min(880px,100%);margin-inline:auto;padding-inline:var(--gutter)}

/* Tones: what each state looks like, used by badges, dots, bars and cards. */
.t-operational{--c:var(--ok);--ink:var(--ok-ink);--soft:var(--ok-soft);--ring:var(--ok-ring)}
.t-degraded{--c:var(--warn);--ink:var(--warn-ink);--soft:var(--warn-soft);--ring:var(--warn-ring)}
.t-down{--c:var(--bad);--ink:var(--bad-ink);--soft:var(--bad-soft);--ring:var(--bad-ring)}
.t-maintenance{--c:var(--maint);--ink:var(--maint-ink);--soft:var(--maint-soft);--ring:var(--maint-ring)}
.t-neutral{--c:var(--label-4);--ink:var(--label-2);--soft:var(--sunken);--ring:var(--fill)}

/* Header: the public site's floating glass bar (.site-header). */
.hd{position:sticky;top:0;z-index:40;padding:10px clamp(10px,2.2vw,24px) 0;pointer-events:none}
.hd-bar{display:flex;align-items:center;gap:12px;height:60px;width:min(1200px,100%);margin-inline:auto;padding:0 8px 0 10px;border:1px solid rgb(16 32 46/7%);border-radius:18px;background:rgb(255 255 255/70%);-webkit-backdrop-filter:saturate(180%) blur(18px);backdrop-filter:saturate(180%) blur(18px);box-shadow:inset 0 1px 0 rgb(255 255 255/75%),0 12px 32px -26px rgb(16 32 46/45%);pointer-events:auto;transition:background-color 240ms ease,box-shadow 240ms ease,border-color 240ms ease}
.hd.is-scrolled .hd-bar{border-color:rgb(16 32 46/9%);background:rgb(255 255 255/86%);box-shadow:inset 0 1px 0 rgb(255 255 255/80%),0 18px 44px -26px rgb(16 32 46/50%),0 2px 8px -4px rgb(16 32 46/12%)}
@media (prefers-reduced-transparency:reduce),(prefers-contrast:more){.hd-bar,.hd.is-scrolled .hd-bar{background:rgb(255 255 255/96%);-webkit-backdrop-filter:none;backdrop-filter:none}}
.brand{display:inline-flex;align-items:center;gap:11px;min-width:max-content;padding:4px;border-radius:12px}
.brand svg{display:block;width:36px;height:36px;flex:none;filter:drop-shadow(0 3px 5px rgb(19 48 70/14%));transition:transform 300ms var(--ease)}
.brand:hover svg{transform:rotate(-6deg) scale(1.05)}
.brand-copy{display:grid;gap:2px}
.brand-copy strong{color:#163b57;font-size:14px;font-weight:780;letter-spacing:.065em;line-height:1.15}
.brand-copy small{color:var(--label-3);font-size:11px;font-weight:550;letter-spacing:.015em}
.hd-nav{display:none;align-items:center;gap:2px;margin-left:auto;padding:4px}
.hd-nav a{position:relative;padding:8px 13px;border-radius:10px;color:#46596b;font-size:14.5px;font-weight:600;transition:color 180ms ease,background-color 180ms ease}
.hd-nav a:hover{color:var(--label);background:rgb(21 59 91/6%)}
.hd-nav a[aria-current]{color:var(--label)}
.hd-nav a[aria-current]::after{content:"";position:absolute;bottom:2px;left:50%;width:4px;height:4px;margin-left:-2px;border-radius:50%;background:var(--ochre)}
.cta{display:inline-flex;min-height:44px;align-items:center;gap:9px;margin-left:auto;padding:0 14px 0 7px;border-radius:13px;background:linear-gradient(180deg,#1d4d74,#153b5b);color:#fff;font-size:14.5px;font-weight:680;white-space:nowrap;box-shadow:inset 0 1px 0 rgb(255 255 255/14%),0 10px 20px -12px rgb(21 59 91/80%);transition:transform 150ms ease,box-shadow 200ms ease}
.cta:hover{box-shadow:inset 0 1px 0 rgb(255 255 255/18%),0 14px 26px -12px rgb(21 59 91/90%)}
.cta:active{transform:scale(.97)}
.cta-icon{display:grid;width:30px;height:30px;place-items:center;border-radius:9px;background:rgb(255 255 255/12%);color:#f1d590}
.cta-icon svg{width:16px;height:16px;transition:transform 220ms var(--ease)}
.cta:hover .cta-icon svg{transform:translate(1px,-1px)}
.cta-long{display:none}
@media (min-width:520px){.cta-long{display:inline}.cta-short{display:none}}
@media (min-width:720px){.hd-nav{display:flex}.hd-nav+.cta{margin-left:0}}
@media (max-width:359px){.brand-copy small{display:none}.cta{padding:0 10px 0 6px;gap:6px}}

main{flex:1;padding-bottom:clamp(72px,10vw,120px)}

/* Hero: the public pages' centred title on paper grain (.pg-hero). */
.hero{position:relative;padding:clamp(40px,8vw,88px) 0 clamp(28px,5vw,44px);text-align:center;isolation:isolate}
.hero::before{content:"";position:absolute;inset:-80px calc(50% - 50vw) 0;z-index:-1;background-image:${NOISE_INK};background-size:180px 180px;opacity:.3;-webkit-mask-image:radial-gradient(ellipse 60% 80% at 50% 0%,#000 15%,transparent 72%);mask-image:radial-gradient(ellipse 60% 80% at 50% 0%,#000 15%,transparent 72%);pointer-events:none}
.hero::after{content:"";position:absolute;top:-40px;left:50%;z-index:-1;width:min(560px,90vw);height:320px;transform:translateX(-50%);background:radial-gradient(closest-side,var(--ring),transparent);pointer-events:none}
.hero-icon{display:inline-grid;width:68px;height:68px;place-items:center;border-radius:50%;background:var(--surface);box-shadow:0 0 0 8px var(--ring),0 12px 28px -14px rgb(16 32 46/35%)}
.hero-icon svg{width:40px;height:40px}
.t-degraded .hero-icon,.t-down .hero-icon{animation:halo 2.4s var(--ease) infinite}
@keyframes halo{0%{box-shadow:0 0 0 0 var(--ring),0 12px 28px -14px rgb(16 32 46/35%)}70%{box-shadow:0 0 0 18px transparent,0 12px 28px -14px rgb(16 32 46/35%)}100%{box-shadow:0 0 0 0 transparent,0 12px 28px -14px rgb(16 32 46/35%)}}
.kicker{margin:22px 0 0;color:var(--gold-ink);font-size:12.5px;font-weight:700;letter-spacing:.14em;line-height:1.4;text-transform:uppercase}
.hero h1{max-width:17ch;margin:10px auto 0;font-family:var(--font-display);font-size:clamp(34px,6.6vw,54px);font-weight:780;letter-spacing:-.042em;line-height:1.04;text-wrap:balance}
.lede{max-width:34em;margin:16px auto 0;color:var(--label-2);font-size:clamp(16px,1.8vw,18px);line-height:1.6;text-wrap:pretty}
.live{display:inline-flex;min-height:34px;align-items:center;gap:9px;margin-top:24px;padding:0 14px;border:1px solid var(--line);border-radius:999px;background:rgb(255 255 255/80%);color:var(--label-2);font-size:13.5px;font-weight:600}
.pulse{position:relative;width:8px;height:8px;flex:none;border-radius:50%;background:var(--c)}
.pulse::after{content:"";position:absolute;inset:0;border-radius:50%;background:var(--c);animation:ping 2s var(--ease) infinite}
@keyframes ping{0%{transform:scale(1);opacity:.55}80%,100%{transform:scale(2.6);opacity:0}}

/* Sections and cards (ds Section, inset grouped lists). */
.sec{margin-top:clamp(32px,4.5vw,48px)}
.sec-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 12px;margin:0 4px 12px}
.sec-head h2{font-family:var(--font-display);font-size:var(--text-section);font-weight:740;letter-spacing:-.02em;line-height:1.3}
.sec-aside{color:var(--label-3);font-size:var(--text-footnote)}
.sec-aside a,.link{color:var(--navy);font-weight:650}
.sec-aside a:hover,.link:hover{text-decoration:underline;text-underline-offset:3px}
.card{border:1px solid var(--line);border-radius:16px;background:var(--surface);box-shadow:var(--shadow-1)}
.foot{margin:10px 4px 0;color:var(--label-3);font-size:var(--text-footnote)}

/* Badges (ds Badge with a dot). */
.badge{display:inline-flex;min-height:26px;align-items:center;gap:7px;padding:0 10px;border-radius:999px;background:var(--soft);color:var(--ink);font-size:12.5px;font-weight:680;letter-spacing:.01em;white-space:nowrap}
.badge::before{content:"";width:7px;height:7px;flex:none;border-radius:50%;background:var(--c)}
.t-down .badge-live::before,.badge-live.t-down::before,.badge-live.t-degraded::before{animation:blink 1.6s ease-in-out infinite}
@keyframes blink{50%{opacity:.35}}

/* Incident and maintenance cards. */
.inc{position:relative;overflow:hidden;padding:18px 20px 16px}
.inc+.inc{margin-top:12px}
.inc::before{content:"";position:absolute;inset:0 0 auto;height:3px;background:var(--c)}
.inc-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px}
.inc-kind{color:var(--ink);font-size:12.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
.inc h3{margin-top:10px;font-family:var(--font-display);font-size:clamp(18px,2.2vw,20px);font-weight:720;letter-spacing:-.018em;line-height:1.3}
.inc h3 a:hover{text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1.5px}
.inc-meta{margin:10px 0 0;color:var(--label-3);font-size:var(--text-footnote)}
.inc-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;margin-top:14px;padding-top:14px;border-top:1px solid var(--sep)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.chip{display:inline-flex;min-height:28px;align-items:center;padding:0 11px;border:1px solid var(--line);border-radius:999px;background:var(--paper);color:var(--label-2);font-size:12.5px;font-weight:600}
.more{display:inline-flex;align-items:center;gap:4px;color:var(--navy);font-size:var(--text-subhead);font-weight:680;white-space:nowrap}
.more svg{width:16px;height:16px;transition:transform 200ms var(--ease)}
.more:hover svg{transform:translateX(2px)}

/* Text from GitHub issues. */
.prose{margin-top:8px;color:var(--label-2);font-size:var(--text-callout);line-height:1.6}
.prose p{margin:0 0 8px}.prose p:last-child{margin-bottom:0}
.prose ul{margin:4px 0 8px;padding-left:20px}.prose li{margin:2px 0}
.prose strong{color:var(--label);font-weight:650}
.prose a{color:var(--navy);font-weight:650;text-decoration:underline;text-decoration-color:rgb(21 59 91/30%);text-underline-offset:3px}
.prose a:hover{text-decoration-color:currentColor}
.prose code{padding:1px 6px;border-radius:6px;background:var(--sunken);font:13px/1.5 var(--font-mono)}

/* Parts of LASUATOS. */
.parts{margin:0;padding:0;list-style:none}
.part{padding:18px 20px 16px}
.part+.part{border-top:1px solid var(--sep)}
.part-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.part-head h3{font-size:var(--text-body);font-weight:650;letter-spacing:-.006em;line-height:1.3}
.part-hint{margin:3px 0 0;color:var(--label-3);font-size:var(--text-subhead);line-height:1.45}
.bars{display:flex;gap:2px;height:34px;margin-top:14px;touch-action:manipulation}
.bars span{flex:1 1 0;min-width:2px;border-radius:3px;background:var(--none);transition:opacity 160ms ease,transform 160ms var(--ease)}
.bars .b-operational{background:var(--ok)}.bars .b-degraded{background:var(--warn)}.bars .b-down{background:var(--bad)}.bars .b-maintenance{background:var(--maint)}
@media (hover:hover){.bars:hover span{opacity:.5}.bars span:hover{opacity:1;transform:scaleY(1.1)}}
.bars span.is-on{opacity:1;transform:scaleY(1.1)}
.axis{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;color:var(--label-3);font-size:12px}
.axis::before,.axis::after{content:"";order:2;flex:1;height:1px;background:var(--sep)}
.axis::after{order:4}
.axis>:nth-child(1){order:1}.axis>:nth-child(2){order:3;color:var(--label-2);font-weight:650}.axis>:nth-child(3){order:5}
.d30{display:none}
@media (max-width:640px){.bars span:nth-child(-n+${DAYS_SHOWN - 30}){display:none}.bars{gap:3px;height:32px}.d90{display:none}.d30{display:inline}}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin:12px 4px 0;padding:0;list-style:none;color:var(--label-3);font-size:12.5px}
.legend li{display:inline-flex;align-items:center;gap:6px}
.legend i{width:10px;height:10px;border-radius:3px;background:var(--c)}
.legend .t-none i{background:var(--none)}
.tip{position:absolute;z-index:50;max-width:240px;padding:9px 12px;border-radius:12px;background:#10202e;color:rgb(255 255 255/82%);font-size:12.5px;line-height:1.45;box-shadow:0 2px 8px rgb(16 32 46/16%),0 18px 40px -16px rgb(16 32 46/50%);transform:translate(-50%,calc(-100% - 10px));pointer-events:none;animation:tip-in 140ms var(--ease)}
.tip b{display:block;color:#fff;font-weight:650}
.tip::after{content:"";position:absolute;left:var(--arrow,50%);bottom:-5px;width:10px;height:10px;margin-left:-5px;background:#10202e;transform:rotate(45deg);border-radius:2px}
@keyframes tip-in{from{opacity:0;transform:translate(-50%,calc(-100% - 6px))}}

/* Response time. */
.lat-grid{display:grid;gap:12px}
@media (min-width:700px){.lat-grid{grid-template-columns:1fr 1fr}}
.lat{padding:18px 20px 14px}
.lat-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.lat-head h3{font-size:var(--text-subhead);font-weight:650;color:var(--label-2)}
.lat-avg{color:var(--label-3);font-size:12.5px}
.lat-now{margin:6px 0 0;color:var(--label-3);font-size:var(--text-subhead)}
.lat-now strong{margin-right:3px;color:var(--label);font-family:var(--font-display);font-size:28px;font-weight:760;letter-spacing:-.03em;line-height:1.1}
.spark{display:block;width:100%;height:64px;margin-top:10px;overflow:visible}
.spark .line{fill:none;stroke:var(--navy);stroke-width:1.75;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.spark .area{fill:url(#sparkfill);stroke:none}
.spark .avg{stroke:var(--gold);stroke-width:1;stroke-dasharray:3 4;vector-effect:non-scaling-stroke}
.lat .axis{margin-top:6px}
.lat .axis>:nth-child(2){font-weight:500;color:var(--label-3)}
.empty-note{margin:14px 0 6px;color:var(--label-3);font-size:var(--text-subhead)}

/* Past incidents (ds ListRow with a chevron). */
.days{margin:0;padding:0;list-style:none}
.day{display:grid;gap:6px;padding:14px 20px}
.day+.day{border-top:1px solid var(--sep)}
.day-date{color:var(--label);font-size:var(--text-subhead);font-weight:650}
.day-date small{margin-left:6px;color:var(--label-3);font-size:12.5px;font-weight:500}
.day-none{margin:0;color:var(--label-3);font-size:var(--text-subhead)}
@media (min-width:640px){.day{grid-template-columns:150px minmax(0,1fr);gap:18px;align-items:baseline}.day-date small{display:block;margin:2px 0 0}}
.day-one{display:block;padding:8px 10px}
.past{display:flex;align-items:flex-start;gap:12px;margin:0 -10px;padding:8px 10px;border-radius:12px;transition:background-color 150ms ease}
.past+.past{margin-top:2px}
.past:hover{background:var(--sunken)}
.past:active{background:var(--fill)}
.past-dot{width:9px;height:9px;flex:none;margin-top:7px;border-radius:50%;background:var(--c);box-shadow:0 0 0 3px var(--ring)}
.past-body{display:grid;flex:1;gap:2px;min-width:0}
.past-title{color:var(--label);font-size:var(--text-callout);font-weight:650;line-height:1.4}
.past-meta{color:var(--label-3);font-size:var(--text-footnote)}
.past-text{display:-webkit-box;overflow:hidden;color:var(--label-2);font-size:var(--text-footnote);-webkit-box-orient:vertical;-webkit-line-clamp:2}
.past-chev{width:18px;height:18px;flex:none;margin-top:3px;color:var(--label-4);transition:transform 200ms var(--ease)}
.past:hover .past-chev{transform:translateX(2px);color:var(--label-3)}
.list-more{display:flex;justify-content:center;margin-top:16px}
.btn{display:inline-flex;min-height:44px;align-items:center;justify-content:center;gap:8px;padding:0 18px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--navy);font-size:var(--text-callout);font-weight:650;box-shadow:var(--shadow-1);transition:background-color 150ms ease,border-color 150ms ease,transform 150ms ease}
.btn:hover{border-color:rgb(21 59 91/35%)}
.btn:active{transform:scale(.97)}
.btn svg{width:16px;height:16px}
.btn-filled{border-color:transparent;background:linear-gradient(180deg,#1d4d74,#153b5b);color:#fff;box-shadow:inset 0 1px 0 rgb(255 255 255/14%),0 10px 20px -12px rgb(21 59 91/80%)}

/* Inner pages: incident, history, not found (ds PageHeader). */
.page{padding-top:clamp(24px,4vw,40px)}
.back{display:inline-flex;min-height:44px;align-items:center;gap:4px;margin-left:-8px;padding:0 10px 0 4px;border-radius:12px;color:var(--navy);font-size:var(--text-callout);font-weight:650}
.back:hover{background:rgb(21 59 91/6%)}
.back svg{width:20px;height:20px}
.ph{margin-top:12px}
.ph .kicker{margin:0;color:var(--ink,var(--gold-ink))}
.ph h1{margin-top:8px;font-family:var(--font-display);font-size:clamp(30px,5vw,42px);font-weight:780;letter-spacing:-.038em;line-height:1.08;text-wrap:balance}
.ph .lede{margin:12px 0 0;font-size:clamp(16px,1.8vw,17px)}
.ph-badges{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.facts{display:flex;flex-wrap:wrap;margin:24px 0 0;padding:0;overflow:hidden}
.facts>div{flex:1 1 190px;padding:14px 18px;border-top:1px solid var(--sep);border-left:1px solid var(--sep);margin:-1px 0 0 -1px}
.facts dt{color:var(--label-3);font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
.facts dd{margin:4px 0 0;font-size:var(--text-callout);font-weight:600}
.facts .wide{flex-basis:100%}
.facts .chips{margin-top:6px}
.tl{margin:0;padding:6px 20px;list-style:none}
.tl-item{position:relative;display:grid;gap:4px;padding:16px 0 16px 28px}
.tl-item+.tl-item{border-top:1px solid var(--sep)}
.tl-item::before{content:"";position:absolute;left:4px;top:0;bottom:0;width:2px;background:var(--sep)}
.tl-item:first-child::before{top:22px}.tl-item:last-child::before{bottom:calc(100% - 22px)}
.tl-item:only-child::before{display:none}
.tl-dot{position:absolute;left:0;top:18px;width:10px;height:10px;border-radius:50%;background:var(--c);box-shadow:0 0 0 4px var(--surface),0 0 0 6px var(--ring)}
.tl-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px}
.tl-stage{color:var(--ink);font-size:var(--text-callout);font-weight:700}
.tl-time{color:var(--label-3);font-size:var(--text-footnote)}
.tl .prose{margin-top:2px}
.empty{display:grid;justify-items:center;gap:6px;margin-top:24px;padding:clamp(32px,6vw,56px) 24px;text-align:center}
.empty-icon{display:grid;width:52px;height:52px;place-items:center;margin-bottom:8px;border-radius:16px;background:var(--tint-soft);color:var(--navy)}
.empty-icon svg{width:26px;height:26px}
.empty h2{font-family:var(--font-display);font-size:20px;font-weight:740;letter-spacing:-.02em}
.empty p{max-width:30em;margin:0 0 12px;color:var(--label-2);font-size:var(--text-callout)}

/* Footer: the public site's navy sheet (.site-footer), with the grain, the glow and the name. */
.ft{position:relative;z-index:1;overflow:hidden;margin-top:-28px;border-radius:28px 28px 0 0;background:var(--navy-deep);color:rgb(255 255 255/70%);isolation:isolate}
.ft::before{content:"";position:absolute;inset:0;z-index:-1;background-image:${NOISE_LIGHT};background-size:180px 180px;opacity:.16}
.ft::after{content:"";position:absolute;top:-35%;right:-10%;z-index:-1;width:70%;height:90%;background:radial-gradient(closest-side,rgb(197 154 66/15%),transparent);pointer-events:none}
@media (prefers-contrast:more){.ft::before{display:none}}
.ft :focus-visible{outline-color:rgb(227 191 111/75%)}
.ft-main{display:grid;gap:40px;width:min(1200px,100%);margin-inline:auto;padding:clamp(52px,7vw,80px) var(--gutter) 0}
.ft .brand-copy strong{color:#fff}
.ft .brand-copy small{color:rgb(255 255 255/60%)}
.ft .brand svg{border-radius:13px;box-shadow:0 0 0 1px rgb(255 255 255/16%),0 10px 22px -10px rgb(0 0 0/60%);filter:none}
.ft-lead p{max-width:400px;margin:18px 0 0;color:rgb(255 255 255/68%);font-size:15px;line-height:1.65}
.ft-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}
.ft-btn{display:inline-flex;min-height:46px;align-items:center;gap:8px;padding:0 17px;border:1px solid rgb(255 255 255/18%);border-radius:13px;background:rgb(255 255 255/4%);color:#fff;font-size:14.5px;font-weight:680;transition:background-color 150ms ease,transform 150ms ease}
.ft-btn svg{width:16px;height:16px}
.ft-btn:hover{background:rgb(255 255 255/10%)}
.ft-btn.gold{border-color:transparent;background:var(--ochre);color:#10202e}
.ft-btn.gold:hover{background:#d4ab55}
.ft-btn:active{transform:scale(.97)}
.ft-cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:32px 20px}
.ft-cols h2{margin:0 0 12px;color:var(--gold-light);font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
.ft-cols ul{display:grid;gap:2px;margin:0;padding:0;list-style:none}
.ft-cols a{display:inline-flex;align-items:center;gap:6px;padding:7px 0;color:rgb(255 255 255/82%);font-size:15px;font-weight:550;transition:color 150ms ease}
.ft-cols a:hover{color:#fff}
.ft-cols p{margin:0;color:rgb(255 255 255/62%);font-size:14px;line-height:1.6}
.ft-cols .ft-note{grid-column:1/-1}
.ft-word{margin:clamp(40px,5.5vw,72px) 0 0;padding:0 clamp(12px,3vw,40px);background-image:linear-gradient(180deg,rgb(255 255 255/22%) 0%,rgb(255 255 255/8%) 90%);-webkit-background-clip:text;background-clip:text;color:transparent;font-family:var(--font-display);font-size:clamp(56px,17.4vw,250px);font-weight:800;letter-spacing:-.06em;line-height:.92;text-align:center;white-space:nowrap;-webkit-user-select:none;user-select:none}
.ft-dot{display:inline-block;width:.1em;height:.1em;margin-left:.03em;border-radius:50%;background:#c9a24e;box-shadow:0 0 .3em rgb(216 177 92/30%)}
.ft-bottom{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 24px;width:min(1200px,100%);margin-inline:auto;padding:22px var(--gutter) calc(24px + env(safe-area-inset-bottom));border-top:1px solid rgb(255 255 255/10%);color:rgb(255 255 255/55%);font-size:13.5px}
.ft-bottom p{margin:0}
@media (min-width:720px){.ft-cols{grid-template-columns:repeat(3,minmax(0,1fr))}.ft-cols .ft-note{grid-column:auto}}
@media (min-width:980px){.ft-main{grid-template-columns:minmax(0,1fr) minmax(0,1.35fr);gap:64px}}

@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
@media print{.hd,.ft,.skip,.live{display:none}body{background:#fff}.card{box-shadow:none}}
${CURSOR_CSS}`;
