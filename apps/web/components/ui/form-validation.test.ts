// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { nameWrappedFields, showFieldError } from './form-validation';

const text = (ids: string | null) => (ids ?? '').split(' ').filter(Boolean).map((id) => document.getElementById(id)?.textContent?.trim()).join(' | ');

afterEach(() => { document.body.innerHTML = ''; });

describe('naming label-wrapped fields', () => {
  it('names the field by its label, and reads the hint as its description', () => {
    document.body.innerHTML = '<form><label class="account-field"><span>Full name</span><input name="n"><small>As on your class list.</small></label></form>';
    nameWrappedFields(document);
    const input = document.querySelector('input')!;
    expect(text(input.getAttribute('aria-labelledby'))).toBe('Full name');
    expect(text(input.getAttribute('aria-describedby'))).toBe('As on your class list.');
  });

  it('keeps a description the page set, and adds the hint once', () => {
    document.body.innerHTML = '<label><span>Email</span><input aria-describedby="mine"><small id="mine">We send a code.</small></label>';
    nameWrappedFields(document);
    nameWrappedFields(document);
    const input = document.querySelector('input')!;
    expect(input.getAttribute('aria-describedby')).toBe('mine');
  });

  it('turns an error shown later into part of the description, not of the name', () => {
    document.body.innerHTML = '<label><span>Course code</span><input required></label>';
    nameWrappedFields(document);
    const input = document.querySelector('input')!;
    expect(input.hasAttribute('aria-labelledby')).toBe(false);
    showFieldError(input, 'Fill in this field.');
    nameWrappedFields(document);
    expect(text(input.getAttribute('aria-labelledby'))).toBe('Course code');
    expect(text(input.getAttribute('aria-describedby'))).toBe('Fill in this field.');
  });

  it('works when the box comes first (a checkbox with a hint)', () => {
    document.body.innerHTML = '<label><input type="checkbox"><span>Share device details</span><small>Only the browser name.</small></label>';
    nameWrappedFields(document);
    const box = document.querySelector('input')!;
    expect(text(box.getAttribute('aria-labelledby'))).toBe('Share device details');
    expect(text(box.getAttribute('aria-describedby'))).toBe('Only the browser name.');
  });

  it('reads text beside the control inside its wrapper as a note', () => {
    document.body.innerHTML = '<label><span>Pass mark</span><div class="row"><input type="number"><span>%</span></div><small>Most departments use 75.</small></label>';
    nameWrappedFields(document);
    const input = document.querySelector('input')!;
    expect(text(input.getAttribute('aria-labelledby'))).toBe('Pass mark');
    expect(text(input.getAttribute('aria-describedby'))).toBe('Most departments use 75. | %');
  });

  it('leaves alone fields the page named itself, plain labels, and decorations', () => {
    document.body.innerHTML = [
      '<label><span>Search</span><input aria-label="Search courses"><small>hint</small></label>',
      '<label><span>Venue</span><select><option>A</option></select></label>',
      '<label><span>Phone</span><input id="p"><span aria-hidden="true">📞</span></label>',
    ].join('');
    nameWrappedFields(document);
    for (const control of document.querySelectorAll('input, select')) expect(control.hasAttribute('aria-labelledby')).toBe(false);
  });
});
