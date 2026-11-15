import { canonicalCourseCode, courseCodeKey } from '@lasuatos/contracts';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { CourseRegister } from '../../../components/registers/register';

const CODE = /^[A-Za-z0-9 ./-]{2,32}$/;

function decode(segment: string): string | null {
  try {
    const value = decodeURIComponent(segment).trim();
    return CODE.test(value) ? value : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Readonly<{ params: Promise<{ course: string }> }>): Promise<Metadata> {
  const code = decode((await params).course);
  return { title: code ? `${canonicalCourseCode(code)} register` : 'Course register', robots: { index: false, follow: false } };
}

export default async function CourseRegisterPage({ params, searchParams }: Readonly<{
  params: Promise<{ course: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const raw = (await params).course;
  const code = decode(raw);
  if (!code) notFound();
  const key = courseCodeKey(canonicalCourseCode(code));
  // One address per course: /registers/ECE305, however the code was typed.
  if (key !== code) {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(await searchParams)) if (typeof value === 'string') query.set(name, value);
    const rest = query.toString();
    redirect(`/registers/${encodeURIComponent(key)}${rest ? `?${rest}` : ''}`);
  }
  return (
    <Suspense>
      <CourseRegister code={key} />
    </Suspense>
  );
}
