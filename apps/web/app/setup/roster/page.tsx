import type { Metadata } from 'next';
import { RosterPreflight } from '../../../components/roster-preflight';

export const metadata: Metadata = {
  title: 'Course roster preflight',
};

export default function CourseRosterPreflightPage() {
  return <RosterPreflight />;
}
