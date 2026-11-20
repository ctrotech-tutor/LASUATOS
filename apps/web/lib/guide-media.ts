// The student guide videos. They stream from a public Google Drive folder so
// the repo and deploys stay small (see tools/student-guide-video/README.md);
// while the Drive upload is pending they are served from /public/media.
// Posters always stay local because they must paint instantly.
//
// `export=view` on drive.usercontent.google.com serves the raw bytes with range
// support, which is what the <video> element needs for seeking. If Google ever
// changes that endpoint, only this helper needs to change.
const DRIVE_IDS: Record<string, string | null> = {
  master: null,
  'open-account': null,
  face: null,
  mark: null,
  problems: null,
};

const driveUrl = (id: string) => `https://drive.usercontent.google.com/download?id=${id}&export=view`;

const src = (key: keyof typeof DRIVE_IDS, file: string) => {
  const id = DRIVE_IDS[key];
  return id ? driveUrl(id) : `/media/${file}`;
};

export type GuideMedia = Readonly<{ src: string; poster: string; durationLabel: string }>;

export const GUIDE_MEDIA = {
  master: {
    src: src('master', 'student-guide.mp4'),
    poster: '/media/student-guide-poster.jpg',
    durationLabel: '3 min',
  },
  'open-account': {
    src: src('open-account', 'student-guide-open-account.mp4'),
    poster: '/media/student-guide-open-account.jpg',
    durationLabel: '1 min',
  },
  face: {
    src: src('face', 'student-guide-face.mp4'),
    poster: '/media/student-guide-face.jpg',
    durationLabel: '20 sec',
  },
  mark: {
    src: src('mark', 'student-guide-mark.mp4'),
    poster: '/media/student-guide-mark.jpg',
    durationLabel: '35 sec',
  },
  problems: {
    src: src('problems', 'student-guide-problems.mp4'),
    poster: '/media/student-guide-problems.jpg',
    durationLabel: '40 sec',
  },
} as const satisfies Record<string, GuideMedia>;
