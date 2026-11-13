import type { SelectOption } from '../components/ui/select';

interface DepartmentLike {
  readonly id: string;
  readonly name: string;
  readonly code?: string | undefined;
  readonly facultyName?: string | undefined;
}

/** "Department of Mechanical Engineering" → "Mechanical Engineering". */
export function shortDepartmentName(name: string): string {
  return name.replace(/^department\s+of\s+(the\s+)?/i, '').trim() || name;
}

/** "Faculty of Engineering" → "Engineering" (used as a group heading). */
function shortFacultyName(name: string): string {
  return name.replace(/^faculty\s+of\s+(the\s+)?/i, '').trim() || name;
}

/**
 * Departments for a Select: shortened names, listed A–Z under their faculty (the
 * faculty heading only shows when there is more than one), with the department
 * code as a chip so a long list can be scanned and searched by code ("MEE").
 */
export function departmentOptions(departments: readonly DepartmentLike[]): SelectOption[] {
  const faculties = new Set(departments.map((department) => department.facultyName ?? ''));
  const grouped = faculties.size > 1 || (faculties.size === 1 && !faculties.has(''));
  return [...departments]
    .sort((a, b) => (a.facultyName ?? '').localeCompare(b.facultyName ?? '') || shortDepartmentName(a.name).localeCompare(shortDepartmentName(b.name)))
    .map((department) => ({
      value: department.id,
      label: shortDepartmentName(department.name),
      tag: department.code || undefined,
      group: grouped && department.facultyName ? shortFacultyName(department.facultyName) : undefined,
      keywords: `${department.name} ${department.facultyName ?? ''}`,
    }));
}
