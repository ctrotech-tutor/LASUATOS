import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'filled' | 'tinted' | 'gray' | 'plain' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

type CommonProps = {
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
  /** Full width (stacked actions on phones). */
  readonly block?: boolean | undefined;
  /** Shown before the label; give lucide icons size 18 (16 for `sm`). */
  readonly icon?: ReactNode;
  readonly className?: string | undefined;
  readonly children?: ReactNode;
};

type LinkButtonProps = CommonProps & {
  readonly href: string;
  readonly prefetch?: boolean | undefined;
  readonly 'aria-label'?: string | undefined;
};

type NativeButtonProps = CommonProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & {
  readonly href?: undefined;
  /** Shows a spinner, keeps the width, and blocks repeat presses. */
  readonly busy?: boolean | undefined;
};

export function buttonClassName({ variant = 'filled', size = 'md', block = false, className }: Pick<CommonProps, 'variant' | 'size' | 'block' | 'className'>): string {
  return ['ds-btn', `ds-btn-${variant}`, size === 'md' ? '' : `ds-btn-${size}`, block ? 'ds-btn-block' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
}

/** The one button: a link when given `href`, otherwise a native button (type="button" unless set). */
export function Button(props: LinkButtonProps | NativeButtonProps) {
  if (props.href !== undefined) {
    const { href, prefetch, variant, size, block, icon, className, children, 'aria-label': label } = props;
    return (
      <Link className={buttonClassName({ variant, size, block, className })} href={href} {...(prefetch === undefined ? {} : { prefetch })} aria-label={label}>
        {icon}
        {children}
      </Link>
    );
  }
  const { variant, size, block, icon, className, children, busy, type, disabled, ...rest } = props;
  return (
    <button
      {...rest}
      className={buttonClassName({ variant, size, block, className })}
      type={type ?? 'button'}
      disabled={disabled}
      aria-busy={busy ? true : undefined}
    >
      {icon}
      {children}
    </button>
  );
}
