export const rosterColumns = [
  {
    key: 'student_number',
    label: 'Student number',
    maxLength: 64,
    aliases: ['studentnumber', 'matricnumber', 'matricno', 'registrationnumber', 'registrationno'],
  },
  {
    key: 'course_code',
    label: 'Course code',
    maxLength: 32,
    aliases: ['coursecode'],
  },
  {
    key: 'course_title',
    label: 'Course title',
    maxLength: 200,
    aliases: ['coursetitle', 'coursename'],
  },
  {
    key: 'credit_units',
    label: 'Credit units',
    maxLength: 2,
    aliases: ['creditunits', 'creditunit', 'units', 'cu'],
  },
  {
    key: 'department_code',
    label: 'Department code',
    maxLength: 40,
    aliases: ['departmentcode', 'deptcode'],
  },
  {
    key: 'level',
    label: 'Level',
    maxLength: 32,
    aliases: ['level', 'studylevel', 'academiclevel'],
  },
  {
    key: 'academic_session',
    label: 'Academic session',
    maxLength: 32,
    aliases: ['academicsession', 'academicsessioncode', 'session', 'sessioncode'],
  },
  {
    key: 'semester',
    label: 'Semester',
    maxLength: 80,
    aliases: ['semester', 'semestername', 'term'],
  },
] as const;

export type RosterField = (typeof rosterColumns)[number]['key'];
export type RosterColumnMapping = Record<RosterField, number | null>;

export interface RosterIssue {
  record: number | null;
  field: string;
  message: string;
  code: string;
}

export interface CsvParseIssue {
  record: number | null;
  message: string;
  count?: number;
}

export interface RosterPreflightReport {
  totalRecords: number;
  validRecords: number;
  distinctCourses: number;
  courseOfferings: number;
  distinctStudentNumbers: number;
  recordsWithErrors: number;
  issueCount: number;
  mappingReady: boolean;
  readyForReview: boolean;
  issues: RosterIssue[];
}

export function emptyRosterMapping(): RosterColumnMapping {
  return Object.fromEntries(rosterColumns.map(({ key }) => [key, null])) as RosterColumnMapping;
}

function normalizeHeader(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function detectRosterColumns(headers: string[]): RosterColumnMapping {
  const mapping = emptyRosterMapping();

  for (const column of rosterColumns) {
    const aliases = new Set([column.key, ...column.aliases].map(normalizeHeader));
    const matchingIndexes = headers.flatMap((header, index) =>
      aliases.has(normalizeHeader(header)) ? [index] : [],
    );

    if (matchingIndexes.length === 1) {
      mapping[column.key] = matchingIndexes[0] ?? null;
    }
  }

  return mapping;
}

function mappingIssues(
  headers: string[],
  mapping: RosterColumnMapping,
): RosterIssue[] {
  const issues: RosterIssue[] = [];
  const firstFieldByIndex = new Map<number, string>();

  for (const column of rosterColumns) {
    const sourceIndex = mapping[column.key];
    if (sourceIndex === null || sourceIndex < 0 || sourceIndex >= headers.length) {
      issues.push({
        record: null,
        field: column.label,
        message: 'Choose a source column for this required field.',
        code: 'column_unmapped',
      });
      continue;
    }

    const previousField = firstFieldByIndex.get(sourceIndex);
    if (previousField) {
      issues.push({
        record: null,
        field: column.label,
        message: `This source column is already mapped to ${previousField}. Choose a different column.`,
        code: 'column_reused',
      });
    } else {
      firstFieldByIndex.set(sourceIndex, column.label);
    }
  }

  return issues;
}

function normalizeExact(value: string): string {
  return value.normalize('NFKC').trim();
}

function normalizeCourseCode(value: string): string {
  return normalizeExact(value).toLowerCase();
}

function hasValue(value: string): boolean {
  return value.trim().length > 0;
}

const maxStoredIssues = 5000;

function addIssue(
  issues: RosterIssue[],
  counter: { value: number },
  record: number | null,
  field: string,
  message: string,
  code: string,
  count = 1,
): void {
  counter.value += count;
  if (issues.length >= maxStoredIssues) return;
  issues.push({ record, field, message, code });
}

export function validateRosterRows(
  headers: string[],
  dataRows: string[][],
  mapping: RosterColumnMapping,
  parserIssues: CsvParseIssue[] = [],
): RosterPreflightReport {
  const nonBlankRows = dataRows.flatMap((row, index) =>
    row.some((value) => hasValue(value)) ? [{ record: index + 2, values: row }] : [],
  );
  const issues: RosterIssue[] = [];
  const issueCounter = { value: 0 };
  for (const issue of parserIssues) {
    addIssue(issues, issueCounter, issue.record, 'CSV structure', issue.message, 'csv_parse', issue.count);
  }

  const selectedMappingIssues = mappingIssues(headers, mapping);
  for (const issue of selectedMappingIssues) {
    addIssue(issues, issueCounter, issue.record, issue.field, issue.message, issue.code);
  }

  if (selectedMappingIssues.length > 0) {
    const recordsWithErrors = new Set(
      parserIssues.flatMap((issue) => issue.record === null ? [] : [issue.record]),
    );
    return {
      totalRecords: nonBlankRows.length,
      validRecords: 0,
      distinctCourses: 0,
      courseOfferings: 0,
      distinctStudentNumbers: 0,
      recordsWithErrors: recordsWithErrors.size,
      issueCount: issueCounter.value,
      mappingReady: false,
      readyForReview: false,
      issues,
    };
  }

  if (nonBlankRows.length === 0) {
    addIssue(
      issues,
      issueCounter,
      null,
      'File',
      'The header is present, but there are no roster records to check.',
      'no_records',
    );
  }

  const invalidRecords = new Set<number>(
    parserIssues.flatMap((issue) => issue.record === null ? [] : [issue.record]),
  );
  const parserErrorRecords = new Set(
    parserIssues.flatMap((issue) => issue.record === null ? [] : [issue.record]),
  );
  const courseCodes = new Set<string>();
  const offerings = new Set<string>();
  const studentNumbers = new Set<string>();
  const seenEnrollments = new Map<string, number>();
  const courseMetadata = new Map<string, { title: string; units: string; record: number }>();

  for (const { record, values } of nonBlankRows) {
    if (parserErrorRecords.has(record)) continue;

    if (values.length !== headers.length) {
      addIssue(
        issues,
        issueCounter,
        record,
        'CSV structure',
        `This record has ${values.length} columns; the header has ${headers.length}.`,
        'column_count',
      );
      invalidRecords.add(record);
      continue;
    }

    const fieldValues = Object.fromEntries(
      rosterColumns.map(({ key }) => {
        const sourceIndex = mapping[key];
        return [key, sourceIndex === null ? '' : (values[sourceIndex] ?? '').trim()];
      }),
    ) as Record<RosterField, string>;

    for (const column of rosterColumns) {
      const value = fieldValues[column.key];
      if (!value) {
        addIssue(issues, issueCounter, record, column.label, 'This field is required.', 'required');
        invalidRecords.add(record);
      } else if (value.length > column.maxLength) {
        addIssue(
          issues,
          issueCounter,
          record,
          column.label,
          `This value exceeds the ${column.maxLength}-character database limit.`,
          'value_too_long',
        );
        invalidRecords.add(record);
      }
    }

    const unitsValue = fieldValues.credit_units;
    const units = Number(unitsValue);
    const unitsKey = /^\d+$/.test(unitsValue) ? String(units) : unitsValue;
    if (unitsValue && (!/^\d+$/.test(unitsValue) || !Number.isInteger(units) || units > 30)) {
      addIssue(
        issues,
        issueCounter,
        record,
        'Credit units',
        'Enter a whole number from 0 to 30, matching the current database constraint.',
        'credit_units_range',
      );
      invalidRecords.add(record);
    }

    const courseCode = normalizeCourseCode(fieldValues.course_code);
    const studentNumber = normalizeExact(fieldValues.student_number);
    if (courseCode) courseCodes.add(courseCode);
    if (studentNumber) studentNumbers.add(studentNumber);

    if (courseCode && fieldValues.course_title && unitsValue) {
      const previous = courseMetadata.get(courseCode);
      if (
        previous &&
        (normalizeExact(previous.title) !== normalizeExact(fieldValues.course_title) ||
          previous.units !== unitsKey)
      ) {
        addIssue(
          issues,
          issueCounter,
          record,
          'Course details',
          `Course code conflicts with the title or credit units on record ${previous.record}.`,
          'course_metadata_conflict',
        );
        invalidRecords.add(record);
        invalidRecords.add(previous.record);
      } else if (!previous) {
        courseMetadata.set(courseCode, {
          title: fieldValues.course_title,
          units: unitsKey,
          record,
        });
      }
    }

    const offeringParts = [
      fieldValues.academic_session,
      fieldValues.semester,
      fieldValues.department_code,
      courseCode,
      fieldValues.level,
    ];
    if (offeringParts.every((part) => part.length > 0)) {
      const offeringKey = JSON.stringify(offeringParts.map(normalizeExact));
      offerings.add(offeringKey);

      if (studentNumber) {
        const enrollmentKey = JSON.stringify([offeringKey, studentNumber]);
        const previousRecord = seenEnrollments.get(enrollmentKey);
        if (previousRecord !== undefined) {
          addIssue(
            issues,
            issueCounter,
            record,
            'Student number',
            `This student appears more than once in the same course offering. The earlier record is ${previousRecord}.`,
            'duplicate_enrollment',
          );
          invalidRecords.add(record);
          invalidRecords.add(previousRecord);
        } else {
          seenEnrollments.set(enrollmentKey, record);
        }
      }
    }
  }

  issues.sort((left, right) => {
    if (left.record === null) return right.record === null ? 0 : -1;
    if (right.record === null) return 1;
    return left.record - right.record || left.field.localeCompare(right.field);
  });

  return {
    totalRecords: nonBlankRows.length,
    validRecords: Math.max(0, nonBlankRows.length - invalidRecords.size),
    distinctCourses: courseCodes.size,
    courseOfferings: offerings.size,
    distinctStudentNumbers: studentNumbers.size,
    recordsWithErrors: invalidRecords.size,
    issueCount: issueCounter.value,
    mappingReady: true,
    readyForReview: nonBlankRows.length > 0 && issueCounter.value === 0,
    issues,
  };
}
