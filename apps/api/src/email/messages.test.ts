import { describe, expect, it } from 'vitest';
import { renderEmail } from './design.js';
import { contactReceiptMessage, contactTeamMessage, studentEmailCodeMessage } from './messages.js';
import { emailSamples } from './samples.js';

const samples = emailSamples('https://pilot.example.net');

describe('every email LASUATOS sends', () => {
  it('covers each message and variant once', () => {
    expect(samples).toHaveLength(39);
    expect(new Set(samples.map((sample) => sample.id)).size).toBe(samples.length);
  });

  it.each(samples.map((sample) => [sample.id, sample] as const))('%s: is a complete, consistent email', (_id, { message }) => {
    const { html, text, subject } = message;
    expect(subject.length).toBeGreaterThan(0);
    expect(subject.length).toBeLessThanOrEqual(160);
    // Shared layout: document, preview line, logo, brand, footer.
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain('telephone=no');
    expect(html).toContain('https://pilot.example.net/icons/icon-192.png');
    expect(html).toContain('display:none;max-height:0');
    expect(html).toContain('For Truth and Service');
    expect(html).toContain('You’re getting this because');
    expect(html.match(/<h1 /g)).toHaveLength(1);
    // Gmail clips messages over ~102 KB.
    expect(Buffer.byteLength(html)).toBeLessThan(60_000);
    // The plain-text part carries the same message without markup.
    expect(text.startsWith('LASUATOS · Lagos State University')).toBe(true);
    expect(text).toContain('You’re getting this because');
    expect(text).not.toMatch(/<\/?(p|a|table|td|span|strong|div)\b/);
  });

  it('keeps security notices and codes free of anything clickable', () => {
    const linkFree = samples.filter((sample) => sample.linkFree);
    expect(linkFree.map((sample) => sample.id)).toEqual([
      'code-open', 'code-open-jamb', 'code-move', 'code-face', 'code-reset', 'code-matric',
      'staff-role-changed',
      'notice-password-reset', 'notice-password-changed', 'notice-account-taken-over', 'notice-account-released', 'notice-matric-added',
      'notice-passkey-added', 'notice-passkey-removed', 'notice-password-sign-in',
    ]);
    for (const { message } of linkFree) {
      expect(message.html).not.toContain('href=');
      expect(message.text).not.toContain('http');
      expect(message.html).toContain('never contain links');
    }
    for (const { message } of samples.filter((sample) => !sample.linkFree)) {
      expect(message.html).toContain('https://pilot.example.net/contact');
    }
  });

  it('shows the code where people look for it, copyable without spaces', () => {
    const code = studentEmailCodeMessage({ to: 'a@st.lasu.edu.ng', displayName: 'A', code: '482913', expiresInMinutes: 15, purpose: 'open' });
    expect(code.subject).toBe('482913 is your LASUATOS code');
    expect(code.html).toContain('>482913</p>');
    expect(code.text).toContain('Your code: 482913');
    expect(code.text).toContain('Expires in 15 minutes');
  });

  it('a confirmation code delivered to the linked personal email says which LASU address it confirms', () => {
    const code = studentEmailCodeMessage({ to: 'amina@gmail.com', displayName: 'A', code: '482913', expiresInMinutes: 15, purpose: 'move', forEmail: 'a@st.lasu.edu.ng' });
    expect(code.to).toBe('amina@gmail.com');
    expect(code.text).toContain('It confirms your LASU email, a@st.lasu.edu.ng.');
    expect(code.text).toContain('emails go to this personal email');
    expect(code.text).toContain('a code was requested for a@st.lasu.edu.ng on your LASUATOS account');
    // Same address: the ordinary message, no added paragraph.
    const direct = studentEmailCodeMessage({ to: 'a@st.lasu.edu.ng', displayName: 'A', code: '482913', expiresInMinutes: 15, purpose: 'move' });
    expect(direct.text).not.toContain('came here because');
  });

  it('escapes everything people can type, in every block', () => {
    const attack = '"><img src=x onerror=alert(1)>';
    const team = contactTeamMessage({
      to: { email: 'admin@example.net', displayName: attack },
      reference: 'LA-ABCDEF',
      topicLabel: attack,
      senderName: attack,
      senderEmail: 'x@example.net',
      facts: [{ label: attack, value: attack }],
      signedIn: false,
      message: `${attack}\nsecond line`,
      receivedAt: new Date('2026-11-10T09:00:00Z'),
    }, 'https://pilot.example.net');
    expect(team.html).not.toContain('<img src=x');
    expect(team.html).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
    expect(team.html).toContain('second line');
    expect(team.replyTo).toEqual({ email: 'x@example.net', name: attack });
    const receipt = contactReceiptMessage({ to: 'x@example.net', name: attack, reference: 'LA-ABCDEF', topicLabel: attack });
    expect(receipt.html).not.toContain('<img src=x');
  });

  it('puts the inbox preview first and hides it from the body', () => {
    const { html, text } = renderEmail('Subject', {
      preheader: 'Preview <line>',
      kicker: 'Kicker',
      heading: 'Heading',
      blocks: [{ kind: 'paragraph', content: 'Body' }],
      reason: 'You’re getting this because of a test.',
    });
    expect(html.indexOf('Preview &lt;line&gt;')).toBeLessThan(html.indexOf('Heading'));
    expect(text).not.toContain('Preview');
  });
});
