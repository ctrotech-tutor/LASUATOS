import * as Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import {
  detectRosterColumns,
  emptyRosterMapping,
  validateRosterRows,
  type CsvParseIssue,
} from './roster-preflight.js';

// These values are synthetic unit-test strings and do not represent LASU records.
const canonicalHeader = [
  'student_number',
  'course_code',
  'course_title',
  'credit_units',
  'department_code',
  'level',
  'academic_session',
  'semester',
];

function validateCsv(csv: string, parserIssues: CsvParseIssue[] = []) {
  const parsed = Papa.parse<string[]>(csv, {
    dynamicTyping: false,
    header: false,
    skipEmptyLines: 'greedy',
  });
  const [headers = [], ...rows] = parsed.data;
  return {
    parsed,
    report: validateRosterRows(headers, rows, detectRosterColumns(headers), parserIssues),
  };
}

describe('course roster preflight', () => {
  it('detects common source headings and keeps student identifiers as text', () => {
    const csv = [
      'Matric No,Course Code,Course Name,Units,Dept Code,Level,Session,Term',
      '001234,EEE101,Circuit Theory,3,EEE,100,2025/2026,First Semester',
      '001235,EEE101,Circuit Theory,3,EEE,100,2025/2026,First Semester',
      '001234,EEE102,Engineering Drawing,2,EEE,100,2025/2026,First Semester',
    ].join('\n');
    const { parsed, report } = validateCsv(csv);

    expect(parsed.data[1]?.[0]).toBe('001234');
    expect(report).toMatchObject({
      totalRecords: 3,
      validRecords: 3,
      distinctCourses: 2,
      courseOfferings: 2,
      distinctStudentNumbers: 2,
      recordsWithErrors: 0,
      mappingReady: true,
      readyForReview: true,
    });
  });

  it('flags duplicate enrolment in the same offering without echoing the identifier', () => {
    const csv = [
      canonicalHeader.join(','),
      '01234,EEE101,Circuit Theory,3,EEE,100,2025/2026,First Semester',
      '01234,eee101,Circuit Theory,3,EEE,100,2025/2026,First Semester',
    ].join('\n');
    const { report } = validateCsv(csv);
    const duplicateIssue = report.issues.find((issue) => issue.code === 'duplicate_enrollment');

    expect(report.recordsWithErrors).toBe(2);
    expect(duplicateIssue?.record).toBe(3);
    expect(duplicateIssue?.message).toContain('earlier record is 2');
    expect(JSON.stringify(report)).not.toContain('01234');
  });

  it('allows the same student in different course offerings', () => {
    const csv = [
      canonicalHeader.join(','),
      'A001,EEE101,Circuit Theory,3,EEE,100,2025/2026,First Semester',
      'A001,EEE102,Engineering Drawing,2,EEE,100,2025/2026,First Semester',
    ].join('\n');
    const { report } = validateCsv(csv);

    expect(report.readyForReview).toBe(true);
    expect(report.distinctStudentNumbers).toBe(1);
    expect(report.courseOfferings).toBe(2);
  });

  it('flags inconsistent metadata for one institution course code', () => {
    const csv = [
      canonicalHeader.join(','),
      'A001,EEE101,Circuit Theory,3,EEE,100,2025/2026,First Semester',
      'A002,EEE101,Electrical Circuits,3,EEE,100,2025/2026,First Semester',
    ].join('\n');
    const { report } = validateCsv(csv);

    expect(report.issues).toContainEqual(expect.objectContaining({
      code: 'course_metadata_conflict',
      record: 3,
    }));
    expect(report.recordsWithErrors).toBe(2);
  });

  it('treats equivalent whole-number credit-unit spellings consistently', () => {
    const csv = [
      canonicalHeader.join(','),
      'A001,EEE101,Circuit Theory,3,EEE,100,2025/2026,First Semester',
      'A002,EEE101,Circuit Theory,03,EEE,100,2025/2026,First Semester',
    ].join('\n');
    const { report } = validateCsv(csv);

    expect(report.readyForReview).toBe(true);
    expect(report.issues).toHaveLength(0);
  });

  it('checks the credit-unit range and database field lengths', () => {
    const longStudentNumber = 'S'.repeat(65);
    const csv = [
      canonicalHeader.join(','),
      `${longStudentNumber},EEE101,Circuit Theory,31,EEE,100,2025/2026,First Semester`,
    ].join('\n');
    const { report } = validateCsv(csv);

    expect(report.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['value_too_long', 'credit_units_range']),
    );
    expect(report.readyForReview).toBe(false);
  });

  it('does not guess when a source heading is ambiguous or missing', () => {
    const headers = ['Student number', 'Course code', 'Course code'];
    const mapping = detectRosterColumns(headers);
    const report = validateRosterRows(headers, [], mapping);

    expect(report.mappingReady).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'column_unmapped')).toBe(true);
    expect(report.readyForReview).toBe(false);
  });

  it('rejects mapping one source column to multiple required fields', () => {
    const mapping = emptyRosterMapping();
    mapping.student_number = 0;
    mapping.course_code = 0;
    const report = validateRosterRows(['Identifier'], [], mapping);

    expect(report.mappingReady).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'column_reused' }));
  });

  it('keeps issue details bounded for a large malformed roster while retaining counts', () => {
    const rows = Array.from({ length: 800 }, () => ['', '', '', '', '', '', '', 'First Semester']);
    const mapping = detectRosterColumns(canonicalHeader);
    const report = validateRosterRows(canonicalHeader, rows, mapping);

    expect(report.totalRecords).toBe(800);
    expect(report.recordsWithErrors).toBe(800);
    expect(report.issueCount).toBe(5600);
    expect(report.issues).toHaveLength(5000);
    expect(report.readyForReview).toBe(false);
  });

  it('reports inconsistent row width and empty roster files', () => {
    const csv = [
      canonicalHeader.join(','),
      'A001,EEE101,Circuit Theory,3,EEE,100,2025/2026,First Semester',
      'A002,EEE102,Engineering Drawing,2,EEE,100,2025/2026',
    ].join('\n');
    const rowReport = validateCsv(csv).report;
    const emptyReport = validateCsv(canonicalHeader.join(',')).report;

    expect(rowReport.issues).toContainEqual(expect.objectContaining({ code: 'column_count', record: 3 }));
    expect(emptyReport.issues).toContainEqual(expect.objectContaining({ code: 'no_records' }));
  });

  it('handles quoted commas and does not report source values in parser errors', () => {
    const csv = [
      canonicalHeader.join(','),
      'A001,EEE101,"Circuit Theory, I",3,EEE,100,2025/2026,First Semester',
    ].join('\n');
    const cleanReport = validateCsv(csv).report;
    const { report } = validateCsv(csv, [{ record: 2, message: 'CSV quoting could not be read cleanly.' }]);

    expect(cleanReport.readyForReview).toBe(true);
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'csv_parse', record: 2 }));
    expect(JSON.stringify(report)).not.toContain('Circuit Theory');
  });
});
