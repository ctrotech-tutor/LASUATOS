'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { loadLectureCapabilities } from '../lib/lecture-api';

/**
 * Shows the older enrolled-course tools only where they are in use (a course
 * offering exists). Everyone else sees a one-line note instead of empty
 * reports. While the answer loads, nothing is shown, so QR attendance above
 * does not jump around.
 */
export function EnrolledCoursesGate({ children, note }: Readonly<{ children: ReactNode; note: ReactNode }>) {
  const [state, setState] = useState<'loading' | 'used' | 'unused'>('loading');
  useEffect(() => {
    let active = true;
    void loadLectureCapabilities()
      .then((capabilities) => { if (active) setState(capabilities.usesEnrolledCourses ? 'used' : 'unused'); })
      // If the check fails, show the tools rather than hide something that may be in use.
      .catch(() => { if (active) setState('used'); });
    return () => { active = false; };
  }, []);
  if (state === 'loading') return null;
  return state === 'used' ? <>{children}</> : <p className="enrolled-courses-note">{note}</p>;
}
