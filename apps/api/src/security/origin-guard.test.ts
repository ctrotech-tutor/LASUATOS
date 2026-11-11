import { describe, expect, it } from 'vitest';
import { evaluateOrigin, normalizeOrigins } from './origin-guard.js';

const trusted = normalizeOrigins(['https://attendance.example.edu/', 'not a url', 'ftp://files.example.edu']);

function decide(method: string, headers: Record<string, string>) {
  return evaluateOrigin({ method, headers }, trusted);
}

describe('origin guard', () => {
  it('normalizes configured origins and ignores invalid or non-HTTP entries', () => {
    expect([...trusted]).toEqual(['https://attendance.example.edu']);
  });

  it('never blocks safe methods', () => {
    expect(decide('GET', { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' })).toBe('allow');
    expect(decide('HEAD', { origin: 'https://evil.example' })).toBe('allow');
  });

  it('trusts Fetch Metadata for same-origin and user-initiated requests', () => {
    expect(decide('POST', { 'sec-fetch-site': 'same-origin' })).toBe('allow');
    expect(decide('POST', { 'sec-fetch-site': 'none' })).toBe('allow');
  });

  it('blocks cross-site mutations even when the Origin header looks trusted', () => {
    expect(decide('POST', { 'sec-fetch-site': 'cross-site' })).toBe('block');
    expect(decide('DELETE', { 'sec-fetch-site': 'cross-site', origin: 'https://attendance.example.edu' })).toBe('block');
  });

  it('requires an exact trusted Origin for same-site or legacy browser requests', () => {
    expect(decide('POST', { 'sec-fetch-site': 'same-site', origin: 'https://attendance.example.edu' })).toBe('allow');
    expect(decide('POST', { 'sec-fetch-site': 'same-site', origin: 'https://other.example.edu' })).toBe('block');
    expect(decide('POST', { 'sec-fetch-site': 'same-site' })).toBe('block');
    expect(decide('POST', { origin: 'https://attendance.example.edu' })).toBe('allow');
    expect(decide('POST', { origin: 'https://attendance.example.edu.evil.example' })).toBe('block');
    expect(decide('PATCH', { origin: 'null' })).toBe('block');
  });

  it('allows non-browser clients that send neither header (no ambient cookies to forge)', () => {
    expect(decide('POST', {})).toBe('allow');
  });
});
