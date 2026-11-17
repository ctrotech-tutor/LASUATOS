/**
 * Reading Gmail's answers for LASU mail (ADR 030): addresses, dates, bodies,
 * attachments, and making an email's HTML safe to show. Pure functions (the HTML
 * clean-up needs a DOMParser, which browsers and the tests' happy-dom provide).
 */

export interface GmailHeader { readonly name: string; readonly value: string }

export interface GmailPart {
  readonly partId?: string;
  readonly mimeType?: string;
  readonly filename?: string;
  readonly headers?: readonly GmailHeader[];
  readonly body?: { readonly size?: number; readonly data?: string; readonly attachmentId?: string };
  readonly parts?: readonly GmailPart[];
}

export interface GmailMessage {
  readonly id: string;
  readonly threadId: string;
  readonly labelIds?: readonly string[];
  readonly snippet?: string;
  readonly internalDate?: string;
  readonly payload?: GmailPart;
}

export interface Address { readonly name: string; readonly email: string }

export interface MailSummary {
  readonly id: string;
  readonly threadId: string;
  readonly from: Address;
  readonly subject: string;
  readonly snippet: string;
  /** When Gmail received it (ms since 1970). */
  readonly date: number;
  readonly unread: boolean;
  readonly starred: boolean;
  readonly important: boolean;
  /** Gmail's tab: primary, updates, promotions, social, forums. */
  readonly category: 'primary' | 'updates' | 'promotions' | 'social' | 'forums';
}

/* ---------------- encoding ---------------- */

export function decodeBase64Url(data: string): Uint8Array {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return new Uint8Array();
  }
}

/** Text from a part, in its declared charset (Gmail usually re-encodes to UTF-8). */
export function decodeText(data: string, charset = 'utf-8'): string {
  const bytes = decodeBase64Url(data);
  try {
    return new TextDecoder(charset.toLowerCase(), { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Gmail's snippets come HTML-escaped. */
export function unescapeSnippet(snippet: string): string {
  return snippet
    .replace(/&#39;/g, '\'')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

/* ---------------- headers ---------------- */

export function header(part: GmailPart | undefined, name: string): string {
  const wanted = name.toLowerCase();
  return part?.headers?.find((item) => item.name.toLowerCase() === wanted)?.value ?? '';
}

/** `"LASU ICT" <ict@lasu.edu.ng>` → { name: 'LASU ICT', email: 'ict@lasu.edu.ng' }. */
export function parseAddress(value: string): Address {
  const trimmed = value.trim();
  const angle = /^(.*?)\s*<([^<>]+)>\s*$/.exec(trimmed);
  if (angle) {
    const email = angle[2]!.trim().toLowerCase();
    const name = angle[1]!.trim().replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1').trim();
    return { name: name || email, email };
  }
  const email = trimmed.replace(/^mailto:/i, '').toLowerCase();
  return { name: email, email };
}

/** A To/Cc header: addresses split on commas outside quotes and angle brackets. */
export function parseAddressList(value: string): Address[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let angled = false;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    else if (char === '<' && !quoted) angled = true;
    else if (char === '>' && !quoted) angled = false;
    if (char === ',' && !quoted && !angled) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean).map(parseAddress);
}

const CATEGORIES: Readonly<Record<string, MailSummary['category']>> = {
  CATEGORY_UPDATES: 'updates',
  CATEGORY_PROMOTIONS: 'promotions',
  CATEGORY_SOCIAL: 'social',
  CATEGORY_FORUMS: 'forums',
};

export function summaryOf(message: GmailMessage): MailSummary {
  const labels = message.labelIds ?? [];
  const category = labels.map((label) => CATEGORIES[label]).find(Boolean) ?? 'primary';
  return {
    id: message.id,
    threadId: message.threadId,
    from: parseAddress(header(message.payload, 'From') || 'Unknown sender'),
    subject: header(message.payload, 'Subject').trim() || '(no subject)',
    snippet: unescapeSnippet(message.snippet ?? ''),
    date: Number(message.internalDate ?? 0) || Date.parse(header(message.payload, 'Date')) || 0,
    unread: labels.includes('UNREAD'),
    starred: labels.includes('STARRED'),
    important: labels.includes('IMPORTANT'),
    category,
  };
}

/* ---------------- is it really from LASU? ---------------- */

export const isLasuAddress = (email: string) => /(^|[@.])lasu\.edu\.ng$/i.test(email.trim());

/**
 * Anyone can put a LASU address in "From". Google records whether the sending
 * domain vouched for the message (DMARC); a LASU badge shows only when it did,
 * and a warning when it explicitly did not. Mail between LASU accounts carries
 * no such record and gets neither.
 */
export function lasuSender(from: Address, authenticationResults: string): 'verified' | 'suspicious' | 'unknown' {
  if (!isLasuAddress(from.email)) return 'unknown';
  const results = authenticationResults.toLowerCase();
  if (!results) return 'unknown';
  const domain = from.email.slice(from.email.indexOf('@') + 1);
  const headerFrom = /header\.from=([a-z0-9.-]+)/.exec(results)?.[1] ?? '';
  if (/dmarc=pass/.test(results) && (headerFrom === domain || headerFrom.endsWith('lasu.edu.ng'))) return 'verified';
  if (/dmarc=fail/.test(results) || (/spf=(?:fail|softfail)/.test(results) && /dkim=fail/.test(results))) return 'suspicious';
  return 'unknown';
}

/* ---------------- bodies and attachments ---------------- */

export interface MailAttachment {
  readonly partId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly size: number;
  readonly attachmentId: string | null;
  /** Inline data (small parts arrive with the message). */
  readonly data: string | null;
  /** Content-ID without brackets, for images the HTML shows with cid:. */
  readonly contentId: string | null;
  readonly inline: boolean;
}

export interface MailBody {
  readonly html: string | null;
  readonly text: string | null;
  readonly attachments: readonly MailAttachment[];
}

function charsetOf(part: GmailPart): string {
  return /charset="?([^";]+)"?/i.exec(header(part, 'Content-Type'))?.[1] ?? 'utf-8';
}

/** The HTML (else plain text) to show, and the files, from Gmail's part tree. */
export function bodyOf(payload: GmailPart | undefined): MailBody {
  let html: string | null = null;
  let text: string | null = null;
  const attachments: MailAttachment[] = [];
  const walk = (part: GmailPart) => {
    const mime = (part.mimeType ?? '').toLowerCase();
    const disposition = header(part, 'Content-Disposition').toLowerCase();
    const contentId = header(part, 'Content-ID').replace(/^<|>$/g, '').trim() || null;
    const isFile = Boolean(part.filename) || disposition.startsWith('attachment') || (Boolean(part.body?.attachmentId) && !mime.startsWith('text/'));
    if (part.parts?.length) {
      for (const child of part.parts) walk(child);
      return;
    }
    if (isFile) {
      attachments.push({
        partId: part.partId ?? String(attachments.length),
        filename: part.filename || (contentId ? `${contentId}` : 'attachment'),
        mimeType: mime || 'application/octet-stream',
        size: part.body?.size ?? 0,
        attachmentId: part.body?.attachmentId ?? null,
        data: part.body?.data ?? null,
        contentId,
        inline: Boolean(contentId) && !disposition.startsWith('attachment') && mime.startsWith('image/'),
      });
      return;
    }
    const data = part.body?.data;
    if (!data) return;
    if (mime === 'text/html' && html === null) html = decodeText(data, charsetOf(part));
    else if (mime === 'text/plain' && text === null) text = decodeText(data, charsetOf(part));
  };
  if (payload) walk(payload);
  return { html, text, attachments };
}

/* ---------------- plain text ---------------- */

export type TextPiece = { readonly text: string } | { readonly text: string; readonly href: string };

/** Links in plain text become real links (http, https and email addresses only). */
export function linkify(text: string): TextPiece[] {
  const pieces: TextPiece[] = [];
  const pattern = /\bhttps?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) pieces.push({ text: text.slice(last, index) });
    const value = match[0];
    pieces.push({ text: value, href: value.includes('://') ? value : `mailto:${value}` });
    last = index + value.length;
  }
  if (last < text.length) pieces.push({ text: text.slice(last) });
  return pieces;
}

/* ---------------- HTML, made safe ---------------- */

const DROP = 'script, iframe, frame, frameset, object, embed, applet, link, meta, base, noscript, template, portal, svg script';
const SAFE_LINK = /^(https?:|mailto:|tel:|#)/i;

export interface SafeHtml {
  /** The body's inner HTML, cleaned. */
  readonly html: string;
  /** Images from the web that were held back (they can tell the sender you opened it). */
  readonly blockedImages: number;
  /** cid: images, filled in from the message's own attachments. */
  readonly inlineImages: readonly string[];
}

/**
 * Cleans an email's HTML for a sandboxed frame (no scripts run there anyway):
 * drops scripts, frames, forms' actions, event handlers and javascript: links;
 * links open in a new tab. Images from the web are held back unless the student
 * asked for them (`remoteImages`), so senders cannot see when or where an email
 * was read; even then only https pictures load. Inline images (cid:) are kept
 * for the caller to fill from the message's own parts.
 */
export function sanitizeHtml(html: string, options: { readonly remoteImages?: boolean } = {}, parser: DOMParser = new DOMParser()): SafeHtml {
  const doc = parser.parseFromString(html, 'text/html');
  for (const node of Array.from(doc.querySelectorAll(DROP))) node.remove();
  let blockedImages = 0;
  const inlineImages = new Set<string>();
  for (const element of Array.from(doc.body.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith('on') || name === 'formaction' || name === 'srcset' || name === 'ping' || name === 'background' || name === 'action' || name === 'xmlns:xlink') {
        element.removeAttribute(attribute.name);
      } else if ((name === 'href' || name === 'xlink:href') && !SAFE_LINK.test(value)) {
        element.removeAttribute(attribute.name);
      } else if (name === 'style' && /url\s*\(|expression\s*\(|@import/i.test(value)) {
        element.setAttribute('style', value.replace(/url\s*\([^)]*\)/gi, 'none').replace(/expression\s*\([^)]*\)/gi, '').replace(/@import[^;]*;?/gi, ''));
      }
    }
    const tag = element.tagName.toLowerCase();
    if (tag === 'a' || tag === 'area') {
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener noreferrer');
    } else if (tag === 'img' || tag === 'image' || (tag === 'input' && element.getAttribute('type') === 'image')) {
      const src = (element.getAttribute('src') ?? '').trim();
      if (/^cid:/i.test(src)) {
        const cid = src.slice(4).replace(/^<|>$/g, '');
        element.setAttribute('data-cid', cid);
        inlineImages.add(cid);
      } else if (src && !/^data:image\//i.test(src)) {
        const remote = /^(https?:)?\/\//i.test(src);
        if (remote && options.remoteImages) {
          element.setAttribute('src', src.replace(/^(https?:)?\/\//i, 'https://'));
          element.setAttribute('referrerpolicy', 'no-referrer');
          continue;
        }
        blockedImages += 1;
        element.setAttribute('data-blocked', '');
      }
      if (!/^data:image\//i.test(src)) element.removeAttribute('src');
    } else if (tag === 'form') {
      element.removeAttribute('action');
      element.removeAttribute('method');
    } else if (tag === 'input' || tag === 'button' || tag === 'select' || tag === 'textarea') {
      element.setAttribute('disabled', '');
    }
  }
  // Remote fonts and backgrounds in <style> blocks.
  for (const style of Array.from(doc.querySelectorAll('style'))) {
    style.textContent = (style.textContent ?? '').replace(/@import[^;]*;?/gi, '').replace(/url\s*\([^)]*\)/gi, 'none');
  }
  const styles = Array.from(doc.querySelectorAll('style')).map((style) => style.outerHTML).join('');
  for (const style of Array.from(doc.body.querySelectorAll('style'))) style.remove();
  return { html: styles + doc.body.innerHTML, blockedImages, inlineImages: [...inlineImages] };
}

/** The frame's whole document: the cleaned email in the app's type, fitting the width. */
export function mailDocument(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><base target="_blank"><style>
html{color-scheme:light}
body{margin:0;padding:2px 2px 8px;font:15px/1.55 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#17212b;overflow-wrap:anywhere;word-break:break-word}
img{max-width:100%;height:auto}
img[data-blocked]{display:inline-block;min-width:24px;min-height:16px;background:#eef1f4;border-radius:4px}
table{max-width:100%!important}
pre{white-space:pre-wrap}
a{color:#0b5cad}
blockquote{margin:8px 0;padding-left:12px;border-left:3px solid #d5dce3;color:#4d5b68}
</style></head><body>${body}</body></html>`;
}

/* ---------------- lists ---------------- */

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** Initials for the sender's circle. */
export function initials(name: string): string {
  const words = (name.includes('@') ? name.slice(0, name.indexOf('@')) : name).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length === 1 ? words[0]!.slice(0, 2) : `${words[0]![0]}${words[words.length - 1]![0]}`).toUpperCase();
}
