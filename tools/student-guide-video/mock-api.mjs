// Made-up answers for every /api/v1 call the captured screens make. One example student,
// the same one LASUATOS's own help uses (LASU250211184ODEJOBI), so the video and the help
// page agree. Nothing here is a real person's data.

export const EXAMPLE = Object.freeze({
  matric: '250211184',
  surname: 'ODEJOBI',
  firstName: 'Abraham',
  middleName: 'Oluwaseun',
  email: 'abraham.odejobi250211184@st.lasu.edu.ng',
  department: 'Electronic and Computer Engineering',
  faculty: 'Faculty of Engineering',
  level: '100 level',
  set: '2025/2026 set',
  code: '482915',
});

const STUDENT_ID = '7b0d8f8e-2a51-4c55-9a39-0d4c3b8f5e21';

function student() {
  return {
    id: STUDENT_ID,
    email: EXAMPLE.email,
    displayName: `${EXAMPLE.firstName} ${EXAMPLE.surname[0]}${EXAMPLE.surname.slice(1).toLowerCase()}`,
    accountType: 'student',
    emailVerified: true,
    matricNumber: EXAMPLE.matric,
    matricNumberVerified: true,
    sessionExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  };
}

/** A fictional 100-level ECE lecture in progress, venue-checked, face-checked. */
export const LECTURE = Object.freeze({
  id: '9f1c2a44-7d3b-4e8a-b2c1-5d6e7f8a9b0c',
  courseCode: 'ECE 101',
  courseTitle: 'Introduction to Electronic and Computer Engineering',
  takenBy: 'Dr. Adaeze Okonkwo',
  venueName: 'ECE Lecture Theatre',
  // The centre of the (fictional) mapped venue circle; the capture phone's GPS is set inside it.
  latitude: 6.46752,
  longitude: 3.20264,
  turn: 'right',
});

const lecture = () => ({
  ticket: 'ticket-2f8a1c94e6b04d2a8f1c',
  ticketExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  session: {
    id: LECTURE.id,
    courseCode: LECTURE.courseCode,
    courseTitle: LECTURE.courseTitle,
    lecturerName: LECTURE.takenBy,
    takenBy: LECTURE.takenBy,
    endsAt: new Date(Date.now() + 25 * 60_000).toISOString(),
    venueName: LECTURE.venueName,
    venueGuide: {
      campusName: 'Ojo Campus',
      buildingName: LECTURE.venueName,
      floorLabel: null,
      sectionLabel: null,
      latitude: LECTURE.latitude,
      longitude: LECTURE.longitude,
      radiusMeters: 80,
      outline: null,
      allowanceMeters: 20,
    },
    requireVenue: true,
  },
  student: {
    fullName: `${EXAMPLE.surname} ${EXAMPLE.firstName} ${EXAMPLE.middleName}`,
    matricNumber: EXAMPLE.matric,
  },
  alreadyCheckedInAt: null,
  face: { required: true, turn: LECTURE.turn, registered: true },
});

/** The /attendance picture: three courses, one comfortably safe, one on the line, one below. */
const history = () => {
  const now = Date.now();
  const dayMs = 86_400_000;
  const entry = (daysAgo, course, title, method = 'qr') => ({
    id: crypto.randomUUID(),
    courseCode: course,
    courseTitle: title,
    checkedInAt: new Date(now - daysAgo * dayMs).toISOString(),
    method,
    venueName: LECTURE.venueName,
    removed: false,
    removedReason: null,
  });
  return {
    entries: [
      entry(0.1, 'ECE 101', 'Introduction to Electronic and Computer Engineering'),
      entry(1, 'MTH 101', 'Elementary Mathematics I'),
      entry(2, 'ECE 101', 'Introduction to Electronic and Computer Engineering'),
      entry(2, 'PHY 101', 'Mechanics, Thermal Physics and Waves'),
      entry(4, 'MTH 101', 'Elementary Mathematics I', 'code'),
      entry(5, 'ECE 101', 'Introduction to Electronic and Computer Engineering'),
      entry(6, 'PHY 101', 'Mechanics, Thermal Physics and Waves'),
    ],
    missed: [
      { id: crypto.randomUUID(), courseCode: 'PHY 101', courseTitle: 'Mechanics, Thermal Physics and Waves', startsAt: new Date(now - 0.5 * dayMs).toISOString(), venueName: 'Physics LT 1' },
    ],
    courses: [
      { courseCode: 'ECE 101', courseTitle: 'Introduction to Electronic and Computer Engineering', held: 12, attended: 11, rate: 92 },
      { courseCode: 'MTH 101', courseTitle: 'Elementary Mathematics I', held: 13, attended: 10, rate: 77 },
      { courseCode: 'PHY 101', courseTitle: 'Mechanics, Thermal Physics and Waves', held: 11, attended: 7, rate: 64 },
    ],
  };
};
const unauthorized = { status: 401, body: { type: 'about:blank', title: 'Unauthorized', status: 401 } };
const notFound = (path) => ({ status: 404, body: { type: 'about:blank', title: 'Not Found', status: 404, instance: path } });

/**
 * A request handler for one capture run. `signedIn` decides what the session routes say;
 * opening an account flips it, as on the real site. `lecture: true` adds a live ECE 101
 * class to scan into; `history: true` adds the /attendance numbers.
 */
export function routes({ signedIn = false, extra = {}, lecture: withLecture = false, history: withHistory = false, lectureDelay = 900 } = {}) {
  let session = signedIn;
  return async (method, path, body) => {
    const key = `${method} ${path}`;
    if (extra[key]) return typeof extra[key] === 'function' ? extra[key](body) : extra[key];
    switch (key) {
      case 'GET /api/v1/status/notices':
        return { body: { statusPageUrl: null, notices: [] } };
      case 'GET /api/v1/auth/session/status':
        return session ? { body: { status: 'authenticated', account: student() } } : { body: { status: 'signed_out' } };
      case 'GET /api/v1/auth/session':
        return session ? { body: { account: student() } } : unauthorized;
      case 'GET /api/v1/students/google':
        // A configured Google button (the app draws it itself; nothing is fetched from Google).
        return { body: { clientId: 'example.apps.googleusercontent.com', redirectUri: 'http://127.0.0.1:3100/auth/google', hostedDomain: 'st.lasu.edu.ng' } };
      case 'POST /api/v1/students/lookup':
        return {
          delay: 900,
          body: {
            status: 'found',
            matricNumber: EXAMPLE.matric,
            fullName: `${EXAMPLE.surname} ${EXAMPLE.firstName} ${EXAMPLE.middleName}`,
            departmentName: EXAMPLE.department,
            levelLabel: EXAMPLE.level,
            hasAccount: false,
            accountStatus: 'none',
            emailOnList: true,
            numberKind: 'matric',
          },
        };
      case 'POST /api/v1/students/open/code':
        return { delay: 500, body: { status: 'sent', email: EXAMPLE.email, expiresInSeconds: 600, resendInSeconds: 60 } };
      case 'POST /api/v1/students/open':
        session = true;
        return { delay: 700, body: { status: 'opened', student: student(), startingPassword: `LASU${EXAMPLE.matric}${EXAMPLE.surname}`, takenOver: false } };
      case 'POST /api/v1/students/me/face/warm':
        return { status: 202, body: { status: 'accepted' } };
      case 'POST /api/v1/students/me/face':
        return { delay: 1600, body: { status: 'registered', enrolledAt: new Date().toISOString() } };
      case 'POST /api/v1/lecture/resolve':
        if (!withLecture) return notFound(path);
        console.log('resolve called at', new Date().toISOString().slice(11, 23));
        return { delay: lectureDelay, body: lecture() };
      case 'POST /api/v1/lecture/check-in':
        if (!withLecture) return notFound(path);
        return {
          delay: 1400,
          body: {
            status: 'checked_in',
            courseCode: LECTURE.courseCode,
            courseTitle: LECTURE.courseTitle,
            fullName: `${EXAMPLE.surname} ${EXAMPLE.firstName} ${EXAMPLE.middleName}`,
            matricNumber: EXAMPLE.matric,
            checkedInAt: new Date().toISOString(),
            venueOutcome: 'within',
            locationAccuracyMeters: 12,
            faceScore: 0.94,
          },
        };
      case 'GET /api/v1/student/lecture-history':
        return withHistory ? { body: history() } : unauthorized;
      case 'GET /api/v1/student/attendance':
        return withHistory ? { body: { records: [], missed: [] } } : unauthorized;
      case 'GET /api/v1/student/attendance/summary':
        return withHistory ? { body: { courses: [] } } : unauthorized;
      case 'GET /api/v1/student/attendance/open':
        return withHistory ? { body: { sessions: [] } } : unauthorized;
      case 'GET /api/v1/student/attendance/disputes':
        return withHistory ? { body: { disputes: [], disputableSessions: [], windowDays: 14, openLimit: 2 } } : unauthorized;
      default:
        return notFound(path);
    }
  };
}
