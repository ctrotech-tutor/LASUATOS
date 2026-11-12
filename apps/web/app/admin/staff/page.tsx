import type { Metadata } from 'next';
import { StaffWorkspace } from '../../../components/staff-workspace';

export const metadata: Metadata = {
  title: 'Staff · LASUATOS administration',
  description: 'Invite lecturers and administrators, and manage staff access within your area.',
};

export default function AdminStaffPage() {
  return <StaffWorkspace />;
}
