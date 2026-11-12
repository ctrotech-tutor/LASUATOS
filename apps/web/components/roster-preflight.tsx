'use client';

import * as Papa from 'papaparse';
import type { ParseError } from 'papaparse';
import { ArrowDownToLine, ArrowLeft, Check, FileSpreadsheet, ShieldCheck, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  detectRosterColumns,
  emptyRosterMapping,
  rosterColumns,
  validateRosterRows,
  type CsvParseIssue,
  type RosterColumnMapping,
  type RosterPreflightReport,
} from '../lib/roster-preflight';
import { Select } from './ui/select';

const maxFileBytes = 25 * 1024 * 1024;
const maxRosterRecords = 100_000;
const chunkSizeBytes = 256 * 1024;
const maxStoredParserIssues = 5000;
const templateCsv = `${rosterColumns.map(({ key }) => key).join(',')}\r\n`;

function parseIssueMessage(error: ParseError): string {
  switch (error.code) {
    case 'UndetectableDelimiter':
      return 'A consistent CSV delimiter could not be identified. Save the file as comma-separated CSV.';
    case 'MissingQuotes':
    case 'InvalidQuotes':
      return 'The CSV contains invalid quote formatting. Check quoted text and export the file again.';
    case 'TooFewFields':
    case 'TooManyFields':
      return 'Some records do not match the number of columns in the header.';
  }
}

function downloadTemplate(): void {
  const blob = new Blob([templateCsv], { type: 'text/csv;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = 'lasuatos-roster-preflight-template.csv';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-NG').format(value);
}

function SummaryMetric({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="roster-metric">
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
    </div>
  );
}

function IssueList({ report }: Readonly<{ report: RosterPreflightReport }>) {
  const shownIssues = report.issues.slice(0, 20);
  const omittedIssueDetails = report.issueCount > report.issues.length;

  return (
    <section className="roster-issues" aria-labelledby="roster-issues-heading">
      <div className="roster-issues-heading">
        <div>
          <p className="section-kicker">REVIEW NEEDED</p>
          <h3 id="roster-issues-heading">{formatNumber(report.issueCount)} checks need attention</h3>
        </div>
        {report.issueCount > shownIssues.length ? (
          <span className="quiet-tag">Showing {shownIssues.length} of {formatNumber(report.issueCount)}</span>
        ) : null}
      </div>
      <ul>
        {shownIssues.map((issue, index) => (
          <li key={`${issue.code}-${issue.record ?? 'file'}-${issue.field}-${index}`}>
            <span className="roster-issue-location">
              {issue.record === null ? 'File' : `Record ${issue.record}`} · {issue.field}
            </span>
            <span>{issue.message}</span>
          </li>
        ))}
      </ul>
      {report.issueCount > shownIssues.length ? (
        <p className="roster-issues-footnote">
          {formatNumber(report.issueCount - shownIssues.length)} checks are not shown.{' '}
          {omittedIssueDetails
            ? `Only the first ${formatNumber(report.issues.length)} issue details are kept in memory. `
            : ''}
          Correct the file and run the preflight again to review the updated results.
        </p>
      ) : null}
    </section>
  );
}

export function RosterPreflight() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<RosterColumnMapping>(emptyRosterMapping);
  const [parserIssues, setParserIssues] = useState<CsvParseIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [fileProblem, setFileProblem] = useState('');
  const [dragging, setDragging] = useState(false);

  const report = useMemo(
    () => headers.length === 0 ? null : validateRosterRows(headers, rows, mapping, parserIssues),
    [headers, rows, mapping, parserIssues],
  );

  function resetFileState(): void {
    setHeaders([]);
    setRows([]);
    setMapping(emptyRosterMapping());
    setParserIssues([]);
    setFileProblem('');
  }

  function clearPreflight(): void {
    if (loading) return;
    resetFileState();
    if (inputRef.current) inputRef.current.value = '';
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';
    readFile(file);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    setDragging(false);
    if (loading) return;
    const file = event.dataTransfer.files[0];
    if (file) readFile(file);
  }

  function readFile(file: File): void {
    resetFileState();

    if (!file.name.toLocaleLowerCase('en-NG').endsWith('.csv')) {
      setFileProblem('Choose a CSV file. Save spreadsheet exports as CSV before checking them.');
      return;
    }

    if (file.size === 0) {
      setFileProblem('This file is empty. Choose a CSV with a header row.');
      return;
    }

    if (file.size > maxFileBytes) {
      setFileProblem('This file is larger than 25 MB. Ask for a smaller department-level export before continuing.');
      return;
    }

    setLoading(true);
    const collectedRows: string[][] = [];
    const collectedParserIssues: CsvParseIssue[] = [];
    let overRecordLimit = false;
    let omittedParserIssueCount = 0;

    Papa.parse<string[]>(file, {
      chunkSize: chunkSizeBytes,
      dynamicTyping: false,
      header: false,
      skipEmptyLines: 'greedy',
      chunk(results, parser) {
        if (collectedRows.length + results.data.length > maxRosterRecords + 1) {
          overRecordLimit = true;
          parser.abort();
          return;
        }

        for (const row of results.data) collectedRows.push(row);
        for (const error of results.errors) {
          if (collectedParserIssues.length < maxStoredParserIssues) {
            collectedParserIssues.push({
              record: null,
              message: parseIssueMessage(error),
            });
          } else {
            omittedParserIssueCount += 1;
          }
        }
      },
      complete() {
        setLoading(false);
        if (overRecordLimit) {
          setFileProblem('This file contains more than 100,000 roster records. Split it into smaller department-level files and check each one.');
          return;
        }

        const [headerRow, ...dataRows] = collectedRows;
        if (!headerRow || headerRow.every((value) => value.trim().length === 0)) {
          setFileProblem('No usable header row was found. Use the LASUATOS template or map a valid roster header.');
          return;
        }

        const cleanedHeaders = headerRow.map((value) => value.trim());
        setHeaders(cleanedHeaders);
        setRows(dataRows);
        setMapping(detectRosterColumns(cleanedHeaders));
        setParserIssues(
          omittedParserIssueCount === 0
            ? collectedParserIssues
            : [
                ...collectedParserIssues,
                {
                  record: null,
                  message: 'Additional CSV formatting problems were omitted. Correct the source file and retry.',
                  count: omittedParserIssueCount,
                },
              ],
        );
      },
      error() {
        setLoading(false);
        setFileProblem('The browser could not read this file. Check that it is a valid CSV and try again.');
      },
    });
  }

  function changeMapping(field: keyof RosterColumnMapping, value: string): void {
    setMapping((current) => ({
      ...current,
      [field]: value === '' ? null : Number(value),
    }));
  }

  const requiredMappingsComplete = report?.mappingReady ?? false;

  return (
    <div className="page-stack roster-page">
      <Link className="back-link" href="/setup">
        <ArrowLeft size={16} aria-hidden="true" /> Back to setup
      </Link>

      <section className="page-heading roster-page-heading">
        <div>
          <p className="page-eyebrow">ENGINEERING PILOT PREPARATION</p>
          <h1>Course roster preflight</h1>
          <p className="page-lede">
            Check a department roster export for structural issues before any approved data import is built.
            This does not enroll students or verify records with LASU.
          </p>
        </div>
        <span className="phase-badge">Local check only</span>
      </section>

      <section className="roster-privacy-note" aria-labelledby="roster-privacy-heading">
        <span className="roster-privacy-icon"><ShieldCheck size={19} aria-hidden="true" /></span>
        <div>
          <h2 id="roster-privacy-heading">The selected file stays in this browser.</h2>
          <p>
            The CSV is read locally and is not uploaded, saved, or sent to the API. Student numbers are
            not displayed in the results. Closing or clearing this page removes the in-memory check.
          </p>
        </div>
      </section>

      <section className="roster-step-panel" aria-labelledby="roster-file-heading">
        <div className="roster-step-heading">
          <span className="roster-step-number">01</span>
          <div>
            <p className="section-kicker">SOURCE FILE</p>
            <h2 id="roster-file-heading">Choose a course roster CSV</h2>
          </div>
        </div>
        <p className="roster-step-copy">
          Use a registrar-approved or department-provided export. This check reads at most 25 MB and
          100,000 records at a time. It does not change the source file.
        </p>
        <div className="roster-file-actions">
          <label
            className={`roster-file-picker${dragging ? ' is-dragging' : ''}`}
            htmlFor="roster-csv"
            onDragEnter={(event) => { event.preventDefault(); if (!loading) setDragging(true); }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = loading ? 'none' : 'copy'; }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
            onDrop={handleDrop}
          >
            <FileSpreadsheet size={19} aria-hidden="true" />
            <span>{loading ? 'Reading file locally…' : dragging ? 'Drop the CSV here' : 'Choose or drop a CSV file'}</span>
            <input
              ref={inputRef}
              id="roster-csv"
              type="file"
              accept=".csv,text/csv"
              disabled={loading}
              onChange={handleFileChange}
            />
          </label>
          <button className="roster-secondary-button" type="button" onClick={downloadTemplate}>
            <ArrowDownToLine size={16} aria-hidden="true" /> Download blank column template
          </button>
          {headers.length > 0 ? (
            <button className="roster-clear-button" type="button" onClick={clearPreflight} disabled={loading}>
              <Trash2 size={15} aria-hidden="true" /> Clear file
            </button>
          ) : null}
        </div>
        <p className="roster-template-note">
          The template is a LASUATOS draft format, not an official LASU form or export specification.
        </p>
        {loading ? <p className="roster-live-message" role="status">Reading the CSV in this browser. No network request is made.</p> : null}
        {fileProblem ? <p className="roster-file-problem" role="alert">{fileProblem}</p> : null}
      </section>

      {headers.length > 0 ? (
        <section className="roster-step-panel" aria-labelledby="roster-map-heading">
          <div className="roster-step-heading">
            <span className="roster-step-number">02</span>
            <div>
              <p className="section-kicker">FIELD MAPPING</p>
              <h2 id="roster-map-heading">Match the source columns</h2>
            </div>
          </div>
          <p className="roster-step-copy">
            Common headings are matched automatically. Confirm every selection. Unfamiliar department,
            session, semester, and level values are kept as supplied and are not checked against LASU records.
          </p>
          <div className="roster-mapping-grid">
            {rosterColumns.map((column) => (
              <label className="roster-mapping-field" key={column.key} htmlFor={`map-${column.key}`}>
                <span>{column.label}<i aria-hidden="true">Required</i></span>
                <Select
                  id={`map-${column.key}`}
                  value={mapping[column.key] === null ? '' : String(mapping[column.key])}
                  onValueChange={(next) => changeMapping(column.key, next)}
                  options={[
                    { value: '', label: 'Choose a source column' },
                    ...headers.map((header, index) => ({ value: String(index), label: header || 'Blank heading', description: `Column ${index + 1}` })),
                  ]}
                />
              </label>
            ))}
          </div>
          {report && !requiredMappingsComplete ? (
            <p className="roster-mapping-message" role="status">
              {report.issues.some((issue) => issue.code === 'column_reused')
                ? 'A source column is selected more than once. Give each required field its own column.'
                : 'Map each required field to a different source column to run the checks.'}
            </p>
          ) : null}
        </section>
      ) : null}

      {report && requiredMappingsComplete ? (
        <section className="roster-report-panel" aria-labelledby="roster-report-heading" aria-live="polite">
          <div className={`roster-result-banner${report.readyForReview ? ' is-clear' : ' has-issues'}`}>
            <span className="roster-result-icon" aria-hidden="true">
              {report.readyForReview ? <Check size={18} /> : <FileSpreadsheet size={18} />}
            </span>
            <div>
              <p className="section-kicker">LOCAL PREFLIGHT RESULT</p>
              <h2 id="roster-report-heading">
                {report.readyForReview ? 'Structure checks passed' : 'This file needs review'}
              </h2>
              <p>
                {report.readyForReview
                  ? 'The file matches the draft column contract and has no detected structural conflicts.'
                  : 'Fix the listed issues in the source file, then run the preflight again.'}
              </p>
            </div>
          </div>

          <div className="roster-metrics" aria-label="Roster file summary">
            <SummaryMetric label="Records checked" value={report.totalRecords} />
            <SummaryMetric label="Distinct courses" value={report.distinctCourses} />
            <SummaryMetric label="Course offerings" value={report.courseOfferings} />
            <SummaryMetric label="Distinct student numbers" value={report.distinctStudentNumbers} />
            <SummaryMetric label="Records needing correction" value={report.recordsWithErrors} />
          </div>

          {report.issues.length > 0 ? <IssueList report={report} /> : null}

          <p className="roster-result-disclaimer">
            A clean result means only that this file passes these local structure checks. It does not
            confirm registration, identity, department ownership, course approval, or eligibility to attend.
          </p>
        </section>
      ) : null}
    </div>
  );
}
