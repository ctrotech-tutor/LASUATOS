import type { Metadata } from 'next';
import { StructureWorkspace } from '../../../components/structure-workspace';

export const metadata: Metadata = {
  title: 'Academic structure · LASUATOS administration',
  description: 'Manage faculties, departments, programme lengths and academic sessions.',
};

export default function AdminStructurePage() {
  return <StructureWorkspace />;
}
