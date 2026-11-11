import type { Metadata } from 'next';
import { VenueWorkspace } from '../../../components/venue-workspace';

export const metadata: Metadata = {
  title: 'Venue directory · LASUATOS administration',
  description: 'Manage buildings, venues, and attendance boundaries for your institution.',
};

export default function AdminVenuesPage() {
  return <VenueWorkspace />;
}
