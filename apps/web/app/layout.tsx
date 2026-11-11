import type { Metadata, Viewport } from 'next';
import { AppShell } from '../components/app-shell';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'LASUATOS | Lagos State University',
    template: '%s | LASUATOS',
  },
  description:
    'Course setup, enrollment, and timed attendance check-ins for Lagos State University, beginning with the Faculty of Engineering.',
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
