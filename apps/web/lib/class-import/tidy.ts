import { checkStudentNumber } from '@lasuatos/contracts';

/**
 * The small, certain repairs a person would make by eye before uploading a class list, done
 * for them and always reported (the parser turns each into a note with an example), so nothing
 * changes silently. Only mistakes with one possible meaning are repaired:
 *
 * - a matric (or JAMB) number typed with the letter O for 0 or I/l for 1 ("25O211184");
 * - an email with a comma for a dot, a missing ".ng" on the LASU domain, a well-known misspelt
 *   provider (gmial.com, yahoo.con), "mailto:", spaces or a trailing full stop; placeholders
 *   such as "nil" or "N/A" become empty;
 * - "(DE)" or "D.E." written after a name, which marks a Direct Entry student;
 * - a title before a name ("Mr", "Miss").
 *
 * Anything less certain is left as written for the server's row report.
 */

/** Letters so often typed for digits that they are repaired (S for 5 or B for 8 are not: too unsure). */
const LOOKALIKE: Readonly<Record<string, string>> = { O: '0', o: '0', I: '1', i: '1', l: '1' };

/** A student number with lookalike letters repaired, when that makes it valid; null otherwise. */
export function repairStudentNumber(raw: string): string | null {
  const value = raw.normalize('NFKC').replace(/[\s/.\-'’]+/g, '');
  if (!value || checkStudentNumber(value).ok) return null;
  const swap = (part: string) => [...part].map((character) => (LOOKALIKE[character] ?? character)).join('');
  // A matric number: 9 characters, all digits once repaired.
  if (value.length === 9) {
    const repaired = swap(value);
    if (/^\d{9}$/.test(repaired) && checkStudentNumber(repaired).ok) return repaired;
  }
  // A JAMB number: the digits part repaired, the two letters at the end kept.
  for (const digits of [12, 8]) {
    if (value.length !== digits + 2) continue;
    const repaired = `${swap(value.slice(0, digits))}${value.slice(digits).toUpperCase()}`;
    if (/^\d+[A-Z]{2}$/.test(repaired) && checkStudentNumber(repaired).ok) return repaired;
  }
  return null;
}

const PLACEHOLDER = /^(nil|none|null|n\/?a|-+|\.+|not available|no email|nill)$/i;
const PROVIDERS: readonly [RegExp, string][] = [
  [/^(gmial|gamil|gmai|gmaill|gmal|gnail|gmail\.co|gemail|gmsil)\.?(com?|con|cm|om)?$/, 'gmail.com'],
  [/^gmail\.(con|cm|om|comm|co|c0m|cpm|xom|vom)$/, 'gmail.com'],
  [/^(yaho|yahooo|yhoo|yahho)\.(com?|con)$/, 'yahoo.com'],
  [/^yahoo\.(con|cm|om|comm|co|c0m)$/, 'yahoo.com'],
  [/^(hotmial|hotmal|hotmai)\.(com?|con)$/, 'hotmail.com'],
  [/^hotmail\.(con|cm|om|co)$/, 'hotmail.com'],
  [/^(outlok|outllok|outlook)\.(con|cm|om|co)$/, 'outlook.com'],
  [/^icloud\.(con|cm|om|co)$/, 'icloud.com'],
  // LASU's student domain, its common slips.
  [/^(st\.?lasu|stlasu|st\.lasu\.edu|st\.lasu\.ng|st\.lasu\.edu\.ng\.ng|st\.lasu\.edu\.n|st\.lasu\.edu\.com|st\.lasu\.edu\.gn|st\.lasu\.edun\.ng|st\.lasu\.ed\.ng|st\.lasu\.edu\.ngg|st\.lasu\.eud\.ng)$/, 'st.lasu.edu.ng'],
];

/** The email as it should be, and whether anything was repaired (blank for placeholders). */
export function tidyEmail(raw: string): { readonly value: string; readonly repaired: boolean } {
  const original = raw.trim();
  if (!original || PLACEHOLDER.test(original)) return { value: '', repaired: false };
  let value = original.normalize('NFKC').replace(/^mailto:/i, '').replace(/^[<(["']+|[>)\]"']+$/g, '').replace(/\s+/g, '').replace(/[.,;:]+$/, '').toLowerCase();
  const at = value.lastIndexOf('@');
  if (at > 0) {
    const local = value.slice(0, at).replace(/@+$/, '');
    let domain = value.slice(at + 1).replace(/,/g, '.').replace(/\.{2,}/g, '.');
    for (const [pattern, fixed] of PROVIDERS) {
      if (pattern.test(domain)) {
        domain = fixed;
        break;
      }
    }
    value = `${local}@${domain}`;
  }
  return { value, repaired: value !== original.toLowerCase() };
}

/** "(DE)", "[D.E]", "- DE", "D.E." after a name. */
const DE_MARK = /\s*(?:[([]\s*d\.?\s*e\.?\s*[)\]]|[-–—/]\s*d\.?\s*e\.?|\bd\.e\.?)\s*$/i;
const TITLE = /^(?:mr|mrs|miss|ms|master|mstr)\.?\s+/i;

/**
 * A name without a Direct Entry mark or a title, and what was found. The title comes off only
 * when `wordsLeft` words remain (2 for a whole name in one cell, so "Miss Ade" stays as written;
 * 1 for a first-name or other-names cell beside a surname column).
 */
export function tidyName(raw: string, wordsLeft = 2): { readonly value: string; readonly directEntry: boolean; readonly title: boolean } {
  let value = raw;
  const directEntry = DE_MARK.test(value);
  if (directEntry) value = value.replace(DE_MARK, '');
  const title = TITLE.test(value.trim()) && value.trim().split(/\s+/).length > wordsLeft;
  if (title) value = value.trim().replace(TITLE, '');
  return { value: value.trim(), directEntry, title };
}

/** "UTME", "DE", "Direct Entry", "100", "200 level": a cell that says how the student came in. */
export function isEntryValue(value: string): boolean {
  return /^(utme|de|d\.e\.?|direct\s*entry|jamb|100|200|300)(\s*(level|l|lvl))?$/i.test(value.trim());
}
