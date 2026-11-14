import { describe, expect, it } from 'vitest';
import { ContactMessageRequestSchema } from './index.js';

const base = { topic: 'problem', name: 'Dr. A. Bello-Ojo', email: '  Bello@LASU.edu.ng ', message: 'The QR code does not scan on my Tecno phone in LT1.' } as const;

describe('contact messages', () => {
  it('accepts a normal message and tidies the email and matric number', () => {
    const parsed = ContactMessageRequestSchema.parse({ ...base, matricNumber: '220 591 001', department: '  ' });
    expect(parsed.email).toBe('bello@lasu.edu.ng');
    expect(parsed.matricNumber).toBe('220591001');
    expect(parsed.department).toBeUndefined();
  });

  it('refuses short messages, links as names, odd matric numbers and unknown fields', () => {
    expect(ContactMessageRequestSchema.safeParse({ ...base, message: 'Help' }).success).toBe(false);
    expect(ContactMessageRequestSchema.safeParse({ ...base, name: 'http://spam.example' }).success).toBe(false);
    expect(ContactMessageRequestSchema.safeParse({ ...base, matricNumber: 'ABC123' }).success).toBe(false);
    expect(ContactMessageRequestSchema.safeParse({ ...base, email: 'not-an-email' }).success).toBe(false);
    expect(ContactMessageRequestSchema.safeParse({ ...base, admin: true }).success).toBe(false);
  });
});
