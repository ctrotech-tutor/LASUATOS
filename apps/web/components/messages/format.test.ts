import { contactReplyDue, type ContactInbox, type ContactMessage } from '@lasuatos/contracts';
import { describe, expect, it } from 'vitest';
import {
  agoLabel, applyChange, dueState, durationLabel, factsOf, greetingName, inboxKey, listTime, needsIdentityCheck, neighbourAfter,
  preview, readView, replyHref, startersFor, topicLine, viewHref,
} from './format';

const message = (over: Partial<ContactMessage> = {}): ContactMessage => ({
  id: '11111111-1111-4111-8111-111111111111',
  reference: 'LA-7K3P9Q',
  topic: 'problem',
  status: 'new',
  name: 'Dr. Ada Bello-Ojo',
  email: 'ada.bello@lasu.edu.ng',
  role: 'lecturer',
  department: 'Electronic and Computer Engineering',
  matricNumber: null,
  privacyRequest: null,
  page: 'Take attendance',
  device: 'Chrome on Android',
  students: null,
  message: 'The QR code does not scan from the back of the hall.\nIs there a bigger one?',
  signedIn: true,
  createdAt: '2026-11-09T13:05:00.000Z',
  handledAt: null,
  handledByName: null,
  note: null,
  ...over,
});

describe('the address bar', () => {
  it('reads and writes the view, leaving defaults out', () => {
    const params = new URLSearchParams('show=handled&topic=privacy&q=face&message=la-7k3p9q');
    const view = readView(params);
    expect(view).toEqual({ show: 'handled', topic: 'privacy', q: 'face', message: 'LA-7K3P9Q' });
    expect(viewHref('/admin/messages', view)).toBe('/admin/messages?show=handled&topic=privacy&q=face&message=LA-7K3P9Q');
    expect(viewHref('/admin/messages', readView(new URLSearchParams()))).toBe('/admin/messages');
  });

  it('ignores what it does not know', () => {
    expect(readView(new URLSearchParams('show=archived&topic=spam&message=hello'))).toEqual({ show: 'new', topic: null, q: '', message: null });
  });

  it('caches each list by show, topic and search', () => {
    expect(inboxKey({ show: 'new', topic: null, q: '' })).toBe('admin:messages:new::');
    expect(inboxKey({ show: 'all', topic: 'privacy', q: ' Face ' })).toBe('admin:messages:all:privacy:face');
  });
});

describe('reply dates', () => {
  it('gives two working days, skipping the weekend', () => {
    // Wednesday 09:00 → Friday 09:00; Friday 15:00 → Tuesday 15:00; Saturday → Tuesday.
    expect(contactReplyDue({ topic: 'other', createdAt: '2026-11-11T08:00:00Z' }).toISOString()).toBe('2026-11-13T08:00:00.000Z');
    expect(contactReplyDue({ topic: 'other', createdAt: '2026-11-13T14:00:00Z' }).toISOString()).toBe('2026-11-17T14:00:00.000Z');
    expect(contactReplyDue({ topic: 'account', createdAt: '2026-11-14T09:00:00Z' }).toISOString()).toBe('2026-11-17T09:00:00.000Z');
    // Late Friday in Lagos is still Friday, though it is Friday in UTC too; 23:30 Lagos on Sunday is Sunday.
    expect(contactReplyDue({ topic: 'other', createdAt: '2026-11-15T22:30:00Z' }).toISOString()).toBe('2026-11-17T22:30:00.000Z');
  });

  it('gives privacy requests 30 days', () => {
    expect(contactReplyDue({ topic: 'privacy', createdAt: '2026-11-10T10:00:00Z' }).toISOString()).toBe('2026-12-10T10:00:00.000Z');
  });

  it('says how close a reply is', () => {
    const now = Date.parse('2026-11-12T10:00:00Z');
    expect(dueState(message({ createdAt: '2026-11-11T09:00:00Z' }), now)).toMatchObject({ overdue: false, tone: 'neutral', short: 'Due Fri' });
    expect(dueState(message({ createdAt: '2026-11-06T09:00:00Z' }), now)).toMatchObject({ overdue: true, tone: 'warning', short: 'Overdue', long: 'The reply was due 2 days ago, on Tue 10 Nov' });
    expect(dueState(message({ topic: 'privacy', createdAt: '2026-10-17T09:00:00Z' }), now)).toMatchObject({ overdue: false, tone: 'danger', short: '4 days left' });
    expect(dueState(message({ topic: 'privacy', createdAt: '2026-11-10T09:00:00Z' }), now)).toMatchObject({ tone: 'neutral', short: '28 days left' });
    expect(dueState(message({ topic: 'privacy', createdAt: '2026-10-01T09:00:00Z' }), now)).toMatchObject({ overdue: true, tone: 'danger', short: 'Overdue' });
    expect(dueState(message({ status: 'handled' }), now)).toBeNull();
  });

  it('gives a brief line for the needs-a-look list', () => {
    const now = Date.parse('2026-11-12T10:00:00Z');
    expect(dueState(message({ createdAt: '2026-11-11T09:00:00Z' }), now)?.brief).toBe('Reply by Fri 13 Nov');
    expect(dueState(message({ createdAt: '2026-11-06T09:00:00Z' }), now)?.brief).toBe('Was due Tue 10 Nov');
    expect(dueState(message({ topic: 'privacy', createdAt: '2026-10-17T09:00:00Z' }), now)?.brief).toBe('Reply by Mon 16 Nov');
  });
});

describe('words and times', () => {
  it('greets people the way a reply would', () => {
    expect(greetingName('Dr. Ada Bello-Ojo')).toBe('Dr Bello-Ojo');
    expect(greetingName('Prof Olumide Shittu')).toBe('Prof Shittu');
    expect(greetingName('Chioma Okafor')).toBe('Chioma');
    expect(greetingName('Mrs. Kemi Lawal')).toBe('Mrs Lawal');
  });

  it('shows times like a mail app', () => {
    const now = Date.parse('2026-11-12T10:00:00Z');
    expect(listTime('2026-11-12T08:05:00Z', now)).toBe('09:05');
    expect(listTime('2026-11-11T08:05:00Z', now)).toBe('Yesterday');
    expect(listTime('2026-11-09T08:05:00Z', now)).toBe('Mon');
    expect(listTime('2026-10-01T08:05:00Z', now)).toBe('1 Oct');
    expect(listTime('2025-10-01T08:05:00Z', now)).toBe('1 Oct 2025');
    expect(agoLabel('2026-11-12T09:35:00Z', now)).toBe('25 minutes ago');
    expect(agoLabel('2026-11-08T09:35:00Z', now)).toBe('4 days ago');
    expect(durationLabel(0.4)).toBe('under an hour');
    expect(durationLabel(5.2)).toBe('5 hours');
    expect(durationLabel(30)).toBe('1 day');
  });

  it('shortens the message and names the request', () => {
    expect(preview('Hello\n\nthere   friend')).toBe('Hello there friend');
    expect(preview('x'.repeat(300), 20)).toHaveLength(20);
    expect(topicLine(message({ topic: 'privacy', privacyRequest: 'delete_face' }))).toBe('Privacy: Delete face data');
    expect(topicLine(message())).toBe('Something isn’t working');
  });

  it('lists what the sender told us', () => {
    const facts = factsOf(message({ topic: 'privacy', privacyRequest: 'copy', matricNumber: '240591002', page: null, device: null }));
    expect(facts.map((fact) => `${fact.label}: ${fact.value}`)).toEqual([
      'They are: Lecturer',
      'Department or unit: Electronic and Computer Engineering',
      'Matric number: 240591002',
      'Request: A copy of their data',
    ]);
  });
});

describe('replies', () => {
  it('offers drafts that fit the message', () => {
    expect(startersFor(message()).map((starter) => starter.id)).toEqual(['reply', 'detail']);
    const privacy = message({ topic: 'privacy', privacyRequest: 'delete_face', signedIn: false });
    expect(needsIdentityCheck(privacy)).toBe(true);
    expect(startersFor(privacy).map((starter) => starter.id)).toEqual(['reply', 'verify', 'done']);
    expect(startersFor(message({ topic: 'adoption', department: 'Mechanical Engineering' }))[1]!.text).toContain('for Mechanical Engineering');
  });

  it('builds a mailto link with the reference and the message quoted', () => {
    const href = replyHref(message(), startersFor(message())[1]!, 'Ngozi Eze');
    expect(href.startsWith('mailto:ada.bello%40lasu.edu.ng?subject=')).toBe(true);
    const body = decodeURIComponent(href.split('&body=')[1]!);
    expect(decodeURIComponent(href.split('subject=')[1]!.split('&')[0]!)).toBe('Re: Something isn’t working [LA-7K3P9Q]');
    expect(body).toContain('Hello Dr Bello-Ojo,');
    expect(body).toContain('course code');
    expect(body).toContain('Ngozi Eze\nLASUATOS team');
    expect(body).toContain('> Is there a bigger one?');
  });
});

describe('after a change', () => {
  const inbox = (messages: ContactMessage[]): ContactInbox => ({
    messages,
    nextCursor: null,
    counts: { new: 2, handled: 5 },
    summary: {
      newByTopic: { adoption: 0, problem: 1, account: 0, privacy: 1, other: 0 },
      overdue: 0,
      oldestNewAt: null,
      privacyOpen: [{ id: '22222222-2222-4222-8222-222222222222', reference: 'LA-22222A', name: 'Chioma', topic: 'privacy', privacyRequest: 'copy', createdAt: '2026-11-01T09:00:00.000Z' }],
      overdueOldest: [],
      handledLast30Days: 3,
      medianHandleHours: 20,
    },
  });

  it('takes a handled message out of New and updates the counts', () => {
    const first = message();
    const second = message({ id: '22222222-2222-4222-8222-222222222222', reference: 'LA-22222A', topic: 'privacy' });
    const handled = { ...second, status: 'handled' as const, handledAt: '2026-11-12T10:00:00.000Z' };
    const next = applyChange(inbox([first, second]), 'new', second, handled);
    expect(next.messages.map((item) => item.reference)).toEqual(['LA-7K3P9Q']);
    expect(next.counts).toEqual({ new: 1, handled: 6 });
    expect(next.summary.newByTopic.privacy).toBe(0);
    expect(next.summary.privacyOpen).toEqual([]);
    expect(next.summary.handledLast30Days).toBe(4);
    expect(applyChange(inbox([first, second]), 'all', second, handled).messages[1]!.status).toBe('handled');
  });

  it('moves on to the next message, or the one above at the end', () => {
    const list = [message({ id: 'a' }), message({ id: 'b' }), message({ id: 'c' })];
    expect(neighbourAfter(list, 'b')?.id).toBe('c');
    expect(neighbourAfter(list, 'c')?.id).toBe('b');
    expect(neighbourAfter([list[0]!], 'a')).toBeNull();
  });
});
