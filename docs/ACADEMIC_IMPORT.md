# Academic roster preflight

## Status

The roster preflight is a local browser check. It is not an import pipeline, an official LASU data specification, or a source of verified student or course records. It prepares the product team to agree an import contract with the Faculty of Engineering and the appropriate University data owners.

## Draft column contract

The downloadable header-only template contains these fields:

| Column | Purpose | Current check |
| --- | --- | --- |
| `student_number` | Preserve the institution's student identifier as text | Required, maximum 64 characters, duplicate check within the same course offering |
| `course_code` | Identify a course | Required, maximum 32 characters; compared case-insensitively to match the current database uniqueness rule |
| `course_title` | Course display title | Required, maximum 200 characters; one course code must have consistent title and units in a file |
| `credit_units` | Course credit units | Whole number from 0 to 30, matching the current schema constraint |
| `department_code` | Department key supplied by the source | Required, maximum 40 characters; no lookup is performed |
| `level` | Level value supplied by the source | Required, maximum 32 characters; no local value list is assumed |
| `academic_session` | Session code supplied by the source | Required, maximum 32 characters; no date range is inferred |
| `semester` | Institution-defined semester label | Required, maximum 80 characters; no fixed semester names are assumed |

A user can map source headers to these fields. The auto-matcher recognizes common heading variants but makes no claim that those are LASU's official file headings. Student numbers are read as text so leading zeroes are preserved. Names, emails, phone numbers and dates of birth are not part of this draft contract.

## Checks performed

- Required columns are mapped to different source columns.
- Required cell values are present and fit the current schema's length limits.
- Each row has the same number of columns as the header.
- Credit units fit the current schema constraint.
- A course code does not have conflicting titles or credit units in the same file.
- The same student number does not appear twice in the same session, semester, department, course and level offering. Student identifiers are compared after trimming outer whitespace, without assuming that their letter case is interchangeable.
- Summary counts report records, courses, offerings and distinct student numbers without displaying student numbers.

No institutional database, identity source, registration status, department code, course approval or student eligibility is queried. A clean result means only that the file passes these local checks.

## Data handling

The selected CSV is parsed in the browser in bounded chunks. It is not posted to the Fastify API, written to local storage, or saved by the application. The in-memory data is cleared when the user clears the preflight or leaves the page. Results show row and field references, not raw student numbers. The report keeps at most 5,000 issue details in page memory while retaining the overall issue count. Files are limited to 25 MB and 100,000 data records per check.

This behavior reduces unnecessary transfer, but it is not a substitute for University approval or a privacy review. Use real student data only under an approved process and on a trusted device. The eventual authenticated import must be designed with the data owner, identity source, access model, retention schedule and audit requirements.

## Before server-side import

1. Obtain an approved, sanitized sample export and confirm the authoritative student identifier, course code, department key, session labels and semester labels with the data owner.
2. Agree whether the source is the Registry, Faculty, departmental office or another authorized system, plus the named operational owner.
3. Define identity resolution. A student number alone must not create an account or prove a person's identity.
4. Select the approved identity provider and provision role-scoped access before exposing write endpoints.
5. Provision an authorized development database and review migration, backup and restore procedures. Do not test against production data.
6. Implement a server-side, idempotent, transactional import with row-level error reporting, audit events, authorization and a reviewed correction process.

Until those decisions are made, the preflight remains a preparation tool and no roster is imported or treated as verified.
