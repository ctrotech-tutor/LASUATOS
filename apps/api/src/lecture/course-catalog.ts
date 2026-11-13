import { courseCodeKey, courseLevelFromCode, type LectureCatalogCourse } from '@lasuatos/contracts';

/**
 * The built-in course list: the courses every engineering student in a
 * Nigerian university takes under the NUC Core Curriculum and Minimum Academic
 * Standards (CCMAS, 2022), which LASU adopted from the 2023/2024 session.
 *
 * Checked (November 2026) against:
 *  - NUC, CCMAS Engineering and Technology (2022): the GET, GST and ENT core
 *    and the 100-level basic sciences every engineering programme takes;
 *  - University of Ibadan, Faculty of Technology, "Courses for students under
 *    CCMAS", which lists the same national codes with titles and units.
 * Where the listings disagree on units (GET 203 is 2 units in one and 3 in the
 * other), units are left blank rather than guessed.
 *
 * LASU's own departmental courses (ECE, MEE, CPE, AAE, civil and industrial
 * engineering) are not published online in a form that can be checked, so
 * they are not guessed here either: lecturers add them from the picker, once,
 * and everyone at the institution can then pick them.
 */
export const STANDARD_COURSE_SOURCE =
  'Built-in list: NUC CCMAS (2022) courses shared by all engineering programmes. Departmental courses are added here by lecturers.';

interface StandardCourse {
  readonly code: string;
  readonly title: string;
  readonly units: number | null;
  readonly semester: 1 | 2;
  readonly group: StandardGroup;
}

type StandardGroup =
  | 'General engineering (GET)'
  | 'General studies (GST)'
  | 'Entrepreneurship (ENT)'
  | 'Basic sciences'
  | 'Industrial training (SIWES)';

const C = (code: string, title: string, units: number | null, semester: 1 | 2, group: StandardGroup): StandardCourse => ({ code, title, units, semester, group });

const GET = 'General engineering (GET)';
const GST = 'General studies (GST)';
const ENT = 'Entrepreneurship (ENT)';
const BS = 'Basic sciences';
const SIWES = 'Industrial training (SIWES)';

const STANDARD_COURSES: readonly StandardCourse[] = [
  // 100 level, first semester
  C('GET 101', 'Engineer in Society', 1, 1, GET),
  C('GST 111', 'Communication in English', 2, 1, GST),
  C('MTH 101', 'Elementary Mathematics I', 2, 1, BS),
  C('PHY 101', 'General Physics I', 2, 1, BS),
  C('PHY 103', 'General Physics III', 2, 1, BS),
  C('PHY 107', 'General Practical Physics I', 1, 1, BS),
  C('CHM 101', 'General Chemistry I', 2, 1, BS),
  C('CHM 107', 'General Practical Chemistry I', 1, 1, BS),
  C('COS 101', 'Introduction to Computing Sciences', 3, 1, BS),
  // 100 level, second semester
  C('GET 102', 'Engineering Graphics and Solid Modelling I', 2, 2, GET),
  C('GST 112', 'Nigerian Peoples and Culture', 2, 2, GST),
  C('MTH 102', 'Elementary Mathematics II', 2, 2, BS),
  C('PHY 102', 'General Physics II', 2, 2, BS),
  C('PHY 104', 'General Physics IV', 2, 2, BS),
  C('PHY 108', 'General Practical Physics II', 1, 2, BS),
  C('CHM 102', 'General Chemistry II', 2, 2, BS),
  C('CHM 108', 'General Practical Chemistry II', 1, 2, BS),
  C('STA 111', 'Descriptive Statistics', 3, 2, BS),
  // 200 level, first semester
  C('GET 201', 'Applied Electricity I', 3, 1, GET),
  C('GET 203', 'Engineering Graphics and Solid Modelling II', null, 1, GET),
  C('GET 205', 'Fundamentals of Fluid Mechanics', 3, 1, GET),
  C('GET 207', 'Applied Mechanics', 3, 1, GET),
  C('GET 209', 'Engineering Mathematics I', 3, 1, GET),
  C('GET 211', 'Computing and Software Engineering', 3, 1, GET),
  C('ENT 211', 'Entrepreneurship and Innovation', 2, 1, ENT),
  // 200 level, second semester
  C('GET 202', 'Engineering Materials', 3, 2, GET),
  C('GET 204', 'Students Workshop Practice', 2, 2, GET),
  C('GET 206', 'Fundamentals of Thermodynamics', 3, 2, GET),
  C('GET 208', 'Strength of Materials', 3, 2, GET),
  C('GET 210', 'Engineering Mathematics II', 3, 2, GET),
  C('GST 212', 'Philosophy, Logic and Human Existence', 2, 2, GST),
  C('GET 299', 'SIWES I: Students Work Experience Scheme', 3, 2, SIWES),
  // 300 level, first semester
  C('GET 301', 'Engineering Mathematics III', 3, 1, GET),
  C('GET 305', 'Engineering Statistics and Data Analytics', 3, 1, GET),
  C('GET 307', 'Introduction to Artificial Intelligence, Machine Learning and Convergent Technologies', 3, 1, GET),
  // 300 level, second semester
  C('GET 302', 'Engineering Mathematics IV', 3, 2, GET),
  C('GET 304', 'Technical Writing and Communication', 3, 2, GET),
  C('GET 306', 'Renewable Energy Systems and Technologies', 3, 2, GET),
  C('GST 312', 'Peace and Conflict Resolution', 2, 2, GST),
  C('ENT 312', 'Venture Creation', 2, 2, ENT),
  C('GET 399', 'SIWES II: Students Work Experience Scheme', 4, 2, SIWES),
  // 400 level
  C('GET 499', 'SIWES III: Students Work Experience Scheme', 8, 2, SIWES),
  // 500 level
  C('GET 501', 'Engineering Project Management', 3, 1, GET),
  C('GET 502', 'Engineering Law', 2, 2, GET),
];

/** The built-in list in the shape the API returns. */
export function standardCatalog(): LectureCatalogCourse[] {
  return STANDARD_COURSES.map((course) => ({
    id: null,
    code: course.code,
    title: course.title,
    units: course.units,
    level: courseLevelFromCode(course.code),
    semester: course.semester,
    group: course.group,
    source: 'standard',
    addedByName: null,
    canEdit: false,
  }));
}

const STANDARD_KEYS = new Set(STANDARD_COURSES.map((course) => courseCodeKey(course.code)));

/** Whether a code is on the built-in list. */
export function isStandardCourse(code: string): boolean {
  return STANDARD_KEYS.has(courseCodeKey(code));
}
