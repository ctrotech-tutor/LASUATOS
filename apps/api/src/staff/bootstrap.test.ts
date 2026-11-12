import { describe, expect, it } from 'vitest';
import { parseBootstrapArguments } from './bootstrap.js';

describe('admin:bootstrap argument parsing', () => {
  it('accepts a quoted multi-word name', () => {
    expect(parseBootstrapArguments(['--email', 'a@b.example', '--name', 'Demo Institution Administrator'], 'lasu'))
      .toMatchObject({ displayName: 'Demo Institution Administrator', scope: 'institution', institutionSlug: 'lasu' });
  });

  it('rejoins a name whose quotes were dropped by the shell (Windows)', () => {
    expect(parseBootstrapArguments(
      ['--', '--email', 'a@b.example', '--name', 'Demo', 'Institution', 'Administrator', '--scope', 'institution', '--print-link'],
      'lasu',
    )).toMatchObject({ displayName: 'Demo Institution Administrator', scope: 'institution', printLink: true });
    expect(parseBootstrapArguments(['--name', 'Ada', 'Okafor', '--email', 'a@b.example'], 'lasu').displayName).toBe('Ada Okafor');
  });

  it('still rejects stray words that do not follow --name', () => {
    expect(() => parseBootstrapArguments(['--email', 'a@b.example', 'oops', '--name', 'A'], 'lasu')).toThrow(/Unexpected argument 'oops'/);
    expect(() => parseBootstrapArguments(['--name=Ada', 'Okafor', '--email', 'a@b.example'], 'lasu')).toThrow(/Unexpected argument/);
    expect(() => parseBootstrapArguments(['--email', 'a@b.example', '--scope', 'department', 'ECE', '--name', 'A'], 'lasu')).toThrow(/Unexpected/);
  });
});
