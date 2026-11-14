import type { Metadata } from 'next';
import { ClassListWorkspace } from '../../components/class-list-workspace';

export const metadata: Metadata = {
  title: 'Class list',
  robots: { index: false, follow: false },
};

export default function ClassListPage() {
  return <ClassListWorkspace />;
}
