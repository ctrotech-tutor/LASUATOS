import { LayoutDashboard, QrCode } from 'lucide-react';
import type { PrimaryAction } from '../../lib/workspace';

/** The icon for a primary action: the same ones the workspace menus use. */
export function PrimaryActionIcon({ icon, size }: Readonly<{ icon: PrimaryAction['icon']; size: number }>) {
  if (icon === 'admin') return <LayoutDashboard size={size} aria-hidden="true" />;
  return <QrCode size={size} aria-hidden="true" />;
}
