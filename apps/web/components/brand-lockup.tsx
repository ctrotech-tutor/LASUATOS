import Link from 'next/link';
import { BrandMark } from './brand-mark';

/** The mark plus the name. `light` is for dark surfaces (the public footer). */
export function BrandLockup({ href = '/', tone = 'default' }: Readonly<{ href?: string; tone?: 'default' | 'light' }>) {
  return (
    <Link className={`site-brand${tone === 'light' ? ' is-light' : ''}`} href={href}>
      <BrandMark className="site-brand-mark" />
      <span className="site-brand-copy">
        <strong>LASUATOS</strong>
        <small>Lagos State University</small>
      </span>
      <span className="sr-only">, home</span>
    </Link>
  );
}
