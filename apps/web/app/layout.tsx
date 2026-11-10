import type { Metadata, Viewport } from 'next';
import { AppShell } from '../components/app-shell';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'LASUATOS | Attendance operations',
    template: '%s | LASUATOS',
  },
  description:
    'LASUATOS is a university attendance and venue verification platform in development for Lagos State University.',
  applicationName: 'LASUATOS',
};

export const viewport: Viewport = {
  themeColor: '#153b5b',
  colorScheme: 'light',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-NG">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
