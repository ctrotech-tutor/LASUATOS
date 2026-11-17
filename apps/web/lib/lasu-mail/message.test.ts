// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  bodyOf, decodeText, initials, lasuSender, linkify, mailDocument, parseAddress, parseAddressList, sanitizeHtml, summaryOf, unescapeSnippet, type GmailMessage,
} from './message';

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url');

describe('reading Gmail’s answers', () => {
  it('reads senders, lists of recipients and escaped snippets', () => {
    expect(parseAddress('"LASU ICT, Ojo" <ICT@lasu.edu.ng>')).toEqual({ name: 'LASU ICT, Ojo', email: 'ict@lasu.edu.ng' });
    expect(parseAddress('bursary@lasu.edu.ng')).toEqual({ name: 'bursary@lasu.edu.ng', email: 'bursary@lasu.edu.ng' });
    expect(parseAddressList('"Bello, Amina" <a@st.lasu.edu.ng>, Tunde <t@st.lasu.edu.ng>').map((item) => item.email)).toEqual(['a@st.lasu.edu.ng', 't@st.lasu.edu.ng']);
    expect(unescapeSnippet('Fees &amp; forms: don&#39;t miss &quot;Friday&quot; &lt;3')).toBe('Fees & forms: don\'t miss "Friday" <3');
    expect(initials('Dr. Adeola Ojo')).toBe('DO');
    expect(initials('bursary@lasu.edu.ng')).toBe('BU');
  });

  it('summarises a message for the list', () => {
    const message: GmailMessage = {
      id: 'm1', threadId: 't1', labelIds: ['INBOX', 'UNREAD', 'CATEGORY_UPDATES', 'STARRED'], snippet: 'Hello', internalDate: '1793000000000',
      payload: { headers: [{ name: 'From', value: 'Exams <exams@lasu.edu.ng>' }, { name: 'Subject', value: '  ' }] },
    };
    expect(summaryOf(message)).toEqual({
      id: 'm1', threadId: 't1', from: { name: 'Exams', email: 'exams@lasu.edu.ng' }, subject: '(no subject)', snippet: 'Hello',
      date: 1793000000000, unread: true, starred: true, important: false, category: 'updates',
    });
  });

  it('finds the HTML, the text and the files in the part tree, in their charset', () => {
    const body = bodyOf({
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'multipart/alternative', parts: [
          { partId: '0.0', mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }], body: { data: b64('Ẹ kú àárọ̀') } },
          { partId: '0.1', mimeType: 'text/html', body: { data: b64('<p>Hi <img src="cid:logo@lasu"></p>') } },
        ] },
        { partId: '1', mimeType: 'image/png', filename: '', headers: [{ name: 'Content-ID', value: '<logo@lasu>' }, { name: 'Content-Disposition', value: 'inline' }], body: { attachmentId: 'a1', size: 2048 } },
        { partId: '2', mimeType: 'application/pdf', filename: 'Timetable.pdf', headers: [{ name: 'Content-Disposition', value: 'attachment; filename="Timetable.pdf"' }], body: { attachmentId: 'a2', size: 120_000 } },
      ],
    });
    expect(body.text).toBe('Ẹ kú àárọ̀');
    expect(body.html).toContain('cid:logo@lasu');
    expect(body.attachments.map((file) => [file.filename, file.inline, file.contentId])).toEqual([['logo@lasu', true, 'logo@lasu'], ['Timetable.pdf', false, null]]);
    expect(decodeText(Buffer.from([0xe9]).toString('base64url'), 'iso-8859-1')).toBe('é');
  });

  it('makes plain-text links clickable (web and email only)', () => {
    expect(linkify('See https://lasu.edu.ng/portal. Or write to ict@lasu.edu.ng, javascript:alert(1)')).toEqual([
      { text: 'See ' },
      { text: 'https://lasu.edu.ng/portal', href: 'https://lasu.edu.ng/portal' },
      { text: '. Or write to ' },
      { text: 'ict@lasu.edu.ng', href: 'mailto:ict@lasu.edu.ng' },
      { text: ', javascript:alert(1)' },
    ]);
  });
});

describe('showing an email safely', () => {
  const nasty = `
    <style>@import url(https://track.example/a.css); body { background: url(https://track.example/bg.png) }</style>
    <script>alert(1)</script>
    <p onclick="steal()" style="color:red;background-image:url('https://track.example/p.gif')">Hello</p>
    <a href="javascript:alert(1)">bad</a> <a href="https://lasu.edu.ng">good</a>
    <img src="https://track.example/open.gif" width="1" height="1">
    <img src="cid:logo@lasu"> <img src="data:image/png;base64,iVBORw0KGgo=">
    <iframe srcdoc="<b>evil</b>"></iframe><form action="https://evil.example"><input name="password"></form>
    <svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>`;

  it('drops scripts, frames, handlers, bad links and trackers, and holds back web pictures', () => {
    const safe = sanitizeHtml(nasty);
    expect(safe.html).not.toMatch(/<script|<iframe|onclick|javascript:|track\.example|@import/i);
    expect(safe.html).toContain('href="https://lasu.edu.ng"');
    expect(safe.html).toContain('target="_blank"');
    expect(safe.html).toContain('rel="noopener noreferrer"');
    expect(safe.html).toContain('data-cid="logo@lasu"');
    expect(safe.html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(safe.html).toMatch(/<input[^>]*disabled/);
    expect(safe.blockedImages).toBe(1);
    expect(safe.inlineImages).toEqual(['logo@lasu']);
  });

  it('shows web pictures (over https, without a referrer) only when asked', () => {
    const safe = sanitizeHtml('<img src="http://lasu.edu.ng/banner.png"><img src="//cdn.lasu.edu.ng/x.png">', { remoteImages: true });
    expect(safe.blockedImages).toBe(0);
    expect(safe.html).toContain('src="https://lasu.edu.ng/banner.png"');
    expect(safe.html).toContain('src="https://cdn.lasu.edu.ng/x.png"');
    expect(safe.html).toContain('referrerpolicy="no-referrer"');
  });

  it('wraps it in a document that fits the width and sends no referrer', () => {
    const doc = mailDocument('<p>Hi</p>');
    expect(doc).toContain('<meta name="referrer" content="no-referrer">');
    expect(doc).toContain('<body><p>Hi</p></body>');
  });
});

describe('is it really from LASU?', () => {
  const lasu = { name: 'Registry', email: 'registry@lasu.edu.ng' };
  it('vouches only when Google recorded that LASU’s domain signed it', () => {
    expect(lasuSender(lasu, 'mx.google.com; dkim=pass header.i=@lasu.edu.ng; spf=pass; dmarc=pass (p=NONE) header.from=lasu.edu.ng')).toBe('verified');
    expect(lasuSender(lasu, 'mx.google.com; spf=fail; dkim=fail; dmarc=fail header.from=lasu.edu.ng')).toBe('suspicious');
    expect(lasuSender(lasu, '')).toBe('unknown');
    expect(lasuSender({ name: 'x', email: 'x@gmail.com' }, 'dmarc=pass header.from=gmail.com')).toBe('unknown');
    expect(lasuSender({ name: 'x', email: 'x@lasu.edu.ng.evil.com' }, 'dmarc=pass header.from=lasu.edu.ng.evil.com')).toBe('unknown');
  });
});
