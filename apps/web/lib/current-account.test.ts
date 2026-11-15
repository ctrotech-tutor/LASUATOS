import { describe, expect, it } from 'vitest';
import { addressName, firstName } from './current-account';

describe('firstName', () => {
  it('finds the first name in the ways names reach LASUATOS', () => {
    expect(firstName('Abraham Oluwaseun Odejobi')).toBe('Abraham');
    expect(firstName('OKAFOR Chidinma')).toBe('Chidinma');
    expect(firstName('ODEJOBI Abraham Oluwaseun')).toBe('Abraham');
    expect(firstName('Dr. Folasade Adeyemi')).toBe('Folasade');
    expect(firstName('Prof O.A. Bello')).toBe('Bello');
    expect(firstName('tunde bakare')).toBe('tunde');
    expect(firstName('ADEBAYO')).toBe('ADEBAYO');
  });
});

describe('addressName', () => {
  it('addresses titled staff by title and surname', () => {
    expect(addressName('Dr. Folasade Adeyemi')).toBe('Dr. Adeyemi');
    expect(addressName('Prof O.A. Bello')).toBe('Prof. Bello');
    expect(addressName('professor Funke ADEBAYO')).toBe('Prof. Adebayo');
    expect(addressName('Engr. Tunde Bakare')).toBe('Engr. Bakare');
  });

  it('uses the first name for everyone else', () => {
    expect(addressName('Kehinde Bakare')).toBe('Kehinde');
    expect(addressName('OKAFOR Chidinma')).toBe('Chidinma');
  });
});
