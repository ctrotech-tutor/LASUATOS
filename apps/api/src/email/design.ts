/**
 * The LASUATOS email design system.
 *
 * Every message is described as content blocks, and each block renders both
 * an HTML and a plain-text version so the two never drift apart. The HTML is
 * table-based with inline styles (Gmail, Outlook, Apple Mail, Yahoo), adds a
 * hidden inbox preview line, adapts to phones and dark mode where the client
 * supports it, and escapes every interpolated value.
 */

export type Tone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

/** Inline text: plain strings, bold phrases, or short monospace values. */
export type Inline = string | { readonly strong: string } | { readonly mono: string };
export type Rich = Inline | readonly Inline[];

export const strong = (text: string): Inline => ({ strong: text });
export const mono = (text: string): Inline => ({ mono: text });

export interface Fact {
  readonly label: string;
  readonly value: string;
  /** Monospace value: references, request IDs, matric numbers. */
  readonly mono?: boolean | undefined;
}

export type Block =
  | { readonly kind: 'paragraph'; readonly content: Rich; readonly muted?: boolean }
  | { readonly kind: 'button'; readonly label: string; readonly url: string; readonly fallback?: boolean }
  /** A one-time code or a reference, shown large and easy to copy. */
  | { readonly kind: 'code'; readonly label: string; readonly value: string; readonly caption?: string; readonly size?: 'large' | 'medium' }
  | { readonly kind: 'facts'; readonly rows: readonly Fact[] }
  /** Someone's own words, with their line breaks. */
  | { readonly kind: 'quote'; readonly text: string; readonly cite?: string | undefined }
  | { readonly kind: 'callout'; readonly tone: Tone; readonly title: string; readonly content: Rich }
  | { readonly kind: 'steps'; readonly title: string; readonly items: readonly Rich[] }
  | { readonly kind: 'status'; readonly tone: Tone; readonly label: string };

export interface EmailContent {
  /** The inbox preview line shown after the subject. */
  readonly preheader: string;
  /** Short category label above the heading, e.g. "Account security". */
  readonly kicker: string;
  readonly heading: string;
  /** Who the greeting addresses; omit for no greeting. */
  readonly greeting?: string | undefined;
  readonly blocks: readonly Block[];
  /** Why this person got this email, shown in the footer. */
  readonly reason: string;
  /**
   * 'standard': footer links to Help, Privacy and Contact.
   * 'no-links': nothing in the email is clickable (security notices and codes),
   * so people learn that a LASUATOS security email never asks them to click.
   */
  readonly footer?: 'standard' | 'no-links';
}

export interface RenderedEmail {
  readonly html: string;
  readonly text: string;
}

const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,'Liberation Mono','Courier New',monospace";

export const EMAIL_COLORS = {
  page: '#f2f3ee',
  card: '#ffffff',
  line: '#e3e7e5',
  ink: '#10202e',
  text: '#3b4c5c',
  muted: '#64717a',
  navy: '#153b5b',
  gold: '#c59a42',
  goldInk: '#87661f',
  soft: '#f5f7f8',
} as const;

const TONES: Record<Tone, { readonly background: string; readonly edge: string; readonly title: string }> = {
  info: { background: '#eef3f7', edge: '#153b5b', title: '#153b5b' },
  success: { background: '#ecf6f0', edge: '#2f7d52', title: '#1f6141' },
  warning: { background: '#fbf5e5', edge: '#c59a42', title: '#7a5a17' },
  danger: { background: '#fcefed', edge: '#b4443a', title: '#97342b' },
  neutral: { background: '#f3f5f6', edge: '#8a98a3', title: '#334452' },
};

const ADDRESS = 'Lagos State University, Ojo, Lagos State, Nigeria';
const MOTTO = 'For Truth and Service';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return character;
    }
  });
}

function parts(content: Rich): readonly Inline[] {
  return typeof content === 'string' || !Array.isArray(content) ? [content as Inline] : content;
}

function richHtml(content: Rich, color: string = EMAIL_COLORS.ink): string {
  return parts(content).map((part) => {
    if (typeof part === 'string') return escapeHtml(part);
    if ('strong' in part) return `<strong style="color:${color};font-weight:650">${escapeHtml(part.strong)}</strong>`;
    return `<span style="font-family:${MONO};font-size:0.94em;color:${color}">${escapeHtml(part.mono)}</span>`;
  }).join('');
}

function richText(content: Rich): string {
  return parts(content).map((part) => (typeof part === 'string' ? part : 'strong' in part ? part.strong : part.mono)).join('');
}

/** Keeps long words (URLs, emails) from widening the layout on phones. */
const WRAP = 'word-break:break-word;overflow-wrap:anywhere';

function blockHtml(block: Block): string {
  const c = EMAIL_COLORS;
  switch (block.kind) {
    case 'paragraph':
      return `<p class="${block.muted ? 'em-muted' : 'em-text'}" style="margin:0 0 16px;color:${block.muted ? c.muted : c.text};font-size:${block.muted ? '14px' : '16px'};line-height:1.6;${WRAP}">${richHtml(block.content)}</p>`;

    case 'button': {
      const url = escapeHtml(block.url);
      const label = escapeHtml(block.label);
      const button = [
        '<table role="presentation" class="em-btn-table" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;border-collapse:separate">',
        '<tr><td class="em-btn" align="center" bgcolor="#153b5b" style="border-radius:10px;background:#153b5b">',
        `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${url}" style="height:48px;v-text-anchor:middle;width:280px" arcsize="20%" stroke="f" fillcolor="#153b5b"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold">${label}</center></v:roundrect><![endif]-->`,
        `<!--[if !mso]><!--><a class="em-btn-link" href="${url}" target="_blank" style="display:inline-block;padding:14px 26px;border-radius:10px;background:#153b5b;color:#ffffff;font-family:${FONT};font-size:16px;font-weight:650;line-height:20px;text-decoration:none;mso-hide:all">${label}</a><!--<![endif]-->`,
        '</td></tr></table>',
      ].join('');
      const fallback = block.fallback === false
        ? ''
        : `<p class="em-muted" style="margin:-8px 0 24px;color:${c.muted};font-size:13px;line-height:1.55">Button not working? Copy this link into your browser:<br><a href="${url}" target="_blank" style="color:${c.navy};text-decoration:underline;${WRAP}">${url}</a></p>`;
      return button + fallback;
    }

    case 'code': {
      const large = block.size !== 'medium';
      return [
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;border-collapse:separate">`,
        `<tr><td class="em-soft" align="center" style="padding:${large ? '22px 16px 20px' : '16px'};border:1px solid ${c.line};border-radius:12px;background:${c.soft}">`,
        `<p class="em-muted" style="margin:0 0 6px;color:${c.muted};font-size:12px;font-weight:650;letter-spacing:0.12em;text-transform:uppercase">${escapeHtml(block.label)}</p>`,
        `<p class="em-code em-ink" style="margin:0;color:${c.ink};font-family:${MONO};font-size:${large ? '38px' : '24px'};font-weight:700;letter-spacing:${large ? '0.28em' : '0.08em'};line-height:1.2;${large ? 'padding-left:0.28em;' : ''}">${escapeHtml(block.value)}</p>`,
        block.caption ? `<p class="em-muted" style="margin:10px 0 0;color:${c.muted};font-size:13px;line-height:1.5">${escapeHtml(block.caption)}</p>` : '',
        '</td></tr></table>',
      ].join('');
    }

    case 'facts': {
      const rows = block.rows.map((row, index) => {
        const border = index === 0 ? '' : `border-top:1px solid ${c.line};`;
        return `<tr><td class="em-fact-label em-muted em-line" valign="top" style="${border}padding:11px 12px 11px 0;width:34%;color:${c.muted};font-size:13px;line-height:1.5">${escapeHtml(row.label)}</td>`
          + `<td class="em-fact-value em-ink em-line" valign="top" style="${border}padding:11px 0;color:${c.ink};font-size:${row.mono ? '14px' : '15px'};font-weight:600;line-height:1.5;${row.mono ? `font-family:${MONO};` : ''}${WRAP}">${escapeHtml(row.value)}</td></tr>`;
      }).join('');
      return `<table role="presentation" class="em-facts em-line" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px;border-top:1px solid ${c.line};border-bottom:1px solid ${c.line}">${rows}</table>`;
    }

    case 'quote':
      return [
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px">`,
        `<tr><td class="em-quote" style="padding:16px 18px;border-left:3px solid ${c.gold};border-radius:0 10px 10px 0;background:#faf7ef">`,
        `<p class="em-ink" style="margin:0;color:${c.ink};font-size:15px;line-height:1.65;${WRAP}">${escapeHtml(block.text).replace(/\r?\n/g, '<br>')}</p>`,
        block.cite ? `<p class="em-muted" style="margin:10px 0 0;color:${c.muted};font-size:13px">— ${escapeHtml(block.cite)}</p>` : '',
        '</td></tr></table>',
      ].join('');

    case 'callout': {
      const tone = TONES[block.tone];
      return [
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px">`,
        `<tr><td class="em-callout em-callout-${block.tone}" style="padding:14px 16px;border-left:4px solid ${tone.edge};border-radius:0 10px 10px 0;background:${tone.background}">`,
        `<p class="em-callout-title-${block.tone}" style="margin:0 0 4px;color:${tone.title};font-size:14px;font-weight:700;line-height:1.4">${escapeHtml(block.title)}</p>`,
        `<p class="em-text" style="margin:0;color:${c.text};font-size:14px;line-height:1.6;${WRAP}">${richHtml(block.content)}</p>`,
        '</td></tr></table>',
      ].join('');
    }

    case 'steps': {
      const rows = block.items.map((item, index) => [
        '<tr>',
        `<td valign="top" width="28" style="padding:0 12px 12px 0"><div class="em-step" style="width:26px;height:26px;border-radius:13px;background:#eef3f7;color:${c.navy};font-size:13px;font-weight:700;line-height:26px;text-align:center">${index + 1}</div></td>`,
        `<td valign="top" class="em-text" style="padding:3px 0 12px;color:${c.text};font-size:15px;line-height:1.55;${WRAP}">${richHtml(item)}</td>`,
        '</tr>',
      ].join('')).join('');
      return `<p class="em-ink" style="margin:8px 0 12px;color:${c.ink};font-size:15px;font-weight:700">${escapeHtml(block.title)}</p>`
        + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px">${rows}</table>`;
    }

    case 'status': {
      const tone = TONES[block.tone];
      return `<p style="margin:0 0 18px"><span class="em-status-${block.tone}" style="display:inline-block;padding:5px 12px 5px 10px;border-radius:999px;background:${tone.background};color:${tone.title};font-size:13px;font-weight:700;line-height:18px"><span style="display:inline-block;width:8px;height:8px;margin-right:7px;border-radius:4px;background:${tone.edge};vertical-align:1px"></span>${escapeHtml(block.label)}</span></p>`;
    }
  }
}

function blockText(block: Block): string {
  switch (block.kind) {
    case 'paragraph':
      return richText(block.content);
    case 'button':
      return `${block.label}:\n${block.url}`;
    case 'code':
      return [`${block.label}: ${block.value}`, ...(block.caption ? [block.caption] : [])].join('\n');
    case 'facts':
      return block.rows.map((row) => `  ${row.label}: ${row.value}`).join('\n');
    case 'quote':
      return [...block.text.split('\n').map((line) => `> ${line}`), ...(block.cite ? [`> — ${block.cite}`] : [])].join('\n');
    case 'callout':
      return `${block.title.toUpperCase()}\n${richText(block.content)}`;
    case 'steps':
      return [block.title, ...block.items.map((item, index) => `  ${index + 1}. ${richText(item)}`)].join('\n');
    case 'status':
      return `[ ${block.label} ]`;
  }
}

const STYLE = `
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0!important;padding:0!important;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
u+#body a{color:inherit;text-decoration:none}
.em-btn-link:hover{background:#0e304d!important}
@media (max-width:620px){
.em-outer{padding:20px 12px 28px!important}
.em-pad{padding:28px 22px 26px!important}
.em-h1{font-size:24px!important}
.em-btn-table{width:100%!important}
.em-btn-link{display:block!important;text-align:center!important}
.em-code{font-size:32px!important;letter-spacing:0.2em!important;padding-left:0.2em!important}
.em-fact-label{display:block!important;width:auto!important;padding:11px 0 0!important}
.em-fact-value{display:block!important;padding:2px 0 11px!important;border-top:0!important}
.em-foot{padding:22px 10px 0!important}
}
@media (prefers-color-scheme:dark){
.em-page{background:#0b1620!important}
.em-card{background:#122130!important;border-color:#24384a!important}
.em-ink,.em-ink strong{color:#f1f4f6!important}
.em-text{color:#c6d0d8!important}
.em-text strong{color:#f1f4f6!important}
.em-muted{color:#93a3af!important}
.em-line{border-color:#24384a!important}
.em-soft{background:#182b3b!important;border-color:#2a4155!important}
.em-quote{background:#1d2a2c!important}
.em-step{background:#1c3347!important;color:#e6d3a3!important}
.em-btn,.em-btn-link{background:#d8b15c!important;color:#10202e!important}
.em-callout{background:#172a3a!important}
.em-callout-title-info{color:#9cc3e4!important}
.em-callout-title-success{color:#8fd1ab!important}
.em-callout-title-warning{color:#e6c477!important}
.em-callout-title-danger{color:#f0a49c!important}
.em-callout-title-neutral{color:#c6d0d8!important}
.em-wordmark{color:#f1f4f6!important}
.em-kicker{color:#e0bd6e!important}
.em-foot a{color:#c6d0d8!important}
}
`.replace(/\n/g, '');

/** A hidden inbox preview, padded so the email body does not leak into it. */
function preheaderHtml(preheader: string): string {
  return `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${EMAIL_COLORS.page}">${escapeHtml(preheader)}${'&#847;&zwnj;&nbsp;'.repeat(70)}</div>`;
}

function headerHtml(publicAppUrl: string | undefined): string {
  const logo = publicAppUrl
    ? `<td valign="middle" width="40" style="padding:0 12px 0 0"><img src="${escapeHtml(new URL('/icons/icon-192.png', publicAppUrl).toString())}" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border:0;border-radius:11px"></td>`
    : '';
  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px"><tr>',
    logo,
    '<td valign="middle">',
    `<p class="em-wordmark" style="margin:0;color:${EMAIL_COLORS.navy};font-size:15px;font-weight:800;letter-spacing:0.08em;line-height:1.2">LASUATOS</p>`,
    `<p class="em-muted" style="margin:2px 0 0;color:${EMAIL_COLORS.muted};font-size:12px;line-height:1.3">Lagos State University</p>`,
    '</td></tr></table>',
  ].join('');
}

function footerHtml(content: EmailContent, publicAppUrl: string | undefined): string {
  const c = EMAIL_COLORS;
  const linkStyle = `color:${c.text};text-decoration:underline`;
  const links = content.footer !== 'no-links' && publicAppUrl
    ? `<p style="margin:0 0 12px;font-size:13px;line-height:1.6">${[
        ['Help centre', '/help'],
        ['Privacy', '/privacy'],
        ['Contact us', '/contact'],
      ].map(([label, path]) => `<a href="${escapeHtml(new URL(path!, publicAppUrl).toString())}" target="_blank" style="${linkStyle}">${label}</a>`).join(`<span style="color:${c.muted}">&nbsp;&nbsp;·&nbsp;&nbsp;</span>`)}</p>`
    : '';
  const safety = content.footer === 'no-links'
    ? `<p class="em-muted" style="margin:0 0 12px;color:${c.muted};font-size:12.5px;line-height:1.6">LASUATOS security emails never contain links, and nobody from LASUATOS will ever ask for your password or a code. When in doubt, open LASUATOS yourself.</p>`
    : '';
  return [
    `<tr><td class="em-foot" style="padding:24px 8px 0;font-family:${FONT}">`,
    `<p class="em-muted" style="margin:0 0 12px;color:${c.muted};font-size:12.5px;line-height:1.6">${escapeHtml(content.reason)}</p>`,
    safety,
    links,
    `<p class="em-muted" style="margin:0;color:${c.muted};font-size:12px;line-height:1.6">LASUATOS · ${ADDRESS}<br><span class="em-kicker" style="color:${c.goldInk};font-style:italic">${MOTTO}</span></p>`,
    '</td></tr>',
  ].join('');
}

/** Renders a message in the shared LASUATOS layout. */
export function renderEmail(subject: string, content: EmailContent, publicAppUrl?: string): RenderedEmail {
  const c = EMAIL_COLORS;
  const body = content.blocks.map(blockHtml).join('');
  const html = [
    '<!doctype html>',
    '<html lang="en" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge">',
    '<meta name="x-apple-disable-message-reformatting"><meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">',
    '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">',
    `<title>${escapeHtml(subject)}</title>`,
    '<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style>td,p,a,span{font-family:Arial,sans-serif!important}</style><![endif]-->',
    `<style>${STYLE}</style></head>`,
    `<body id="body" class="em-page" style="margin:0;padding:0;background:${c.page};word-spacing:normal">`,
    preheaderHtml(content.preheader),
    `<div role="article" aria-roledescription="email" aria-label="${escapeHtml(subject)}" lang="en" style="background:${c.page}">`,
    `<table role="presentation" class="em-page" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${c.page}" style="background:${c.page}"><tr><td class="em-outer" align="center" style="padding:36px 16px 40px">`,
    '<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;border-collapse:separate;font-family:${FONT}">`,
    `<tr><td style="padding:0 8px;font-family:${FONT}">${headerHtml(publicAppUrl)}</td></tr>`,
    `<tr><td class="em-card" bgcolor="${c.card}" style="background:${c.card};border:1px solid ${c.line};border-radius:18px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="em-pad" style="padding:38px 40px 30px;font-family:${FONT}">`,
    `<p class="em-kicker" style="margin:0 0 12px;color:${c.goldInk};font-size:12px;font-weight:700;letter-spacing:0.14em;line-height:1.4;text-transform:uppercase"><span style="display:inline-block;width:18px;height:2px;margin-right:10px;background:${c.gold};vertical-align:middle"></span>${escapeHtml(content.kicker)}</p>`,
    `<h1 class="em-h1 em-ink" style="margin:0 0 18px;color:${c.ink};font-size:27px;font-weight:750;letter-spacing:-0.02em;line-height:1.22">${escapeHtml(content.heading)}</h1>`,
    content.greeting ? `<p class="em-text" style="margin:0 0 16px;color:${c.text};font-size:16px;line-height:1.6">Hello ${escapeHtml(content.greeting)},</p>` : '',
    body,
    '</td></tr></table>',
    '</td></tr>',
    footerHtml(content, publicAppUrl),
    '</table>',
    '<!--[if mso]></td></tr></table><![endif]-->',
    '</td></tr></table></div></body></html>',
  ].join('');

  const footerLinks = content.footer !== 'no-links' && publicAppUrl
    ? [`Help centre: ${new URL('/help', publicAppUrl).toString()}`, `Privacy: ${new URL('/privacy', publicAppUrl).toString()}`, `Contact us: ${new URL('/contact', publicAppUrl).toString()}`]
    : [];
  const text = [
    'LASUATOS · Lagos State University',
    '',
    content.kicker.toUpperCase(),
    content.heading,
    '='.repeat(Math.min(content.heading.length, 60)),
    '',
    ...(content.greeting ? [`Hello ${content.greeting},`, ''] : []),
    content.blocks.map(blockText).join('\n\n'),
    '',
    '-- ',
    content.reason,
    ...(content.footer === 'no-links'
      ? ['LASUATOS security emails never contain links, and nobody from LASUATOS will ever ask for your password or a code.']
      : []),
    ...footerLinks,
    '',
    `LASUATOS · ${ADDRESS}`,
    MOTTO,
  ].join('\n');

  return { html, text };
}
