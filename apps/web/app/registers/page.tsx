import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { registerHref } from '../../components/registers/href';
import { RegisterList } from '../../components/registers/list';

export const metadata: Metadata = {
  title: 'Course registers',
  robots: { index: false, follow: false },
};

export default async function RegistersPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const { course, q } = await searchParams;
  // Old links (/registers?course=ECE 305&q=…) go to the register's own address.
  if (typeof course === 'string' && course.trim()) redirect(registerHref(course, typeof q === 'string' && q.trim() ? q.trim() : undefined));
  return <RegisterList />;
}
