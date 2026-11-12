import type { Metadata, Viewport } from 'next';
import { AppShell } from '../components/app-shell';
import '@fontsource-variable/inter';
import '@fontsource-variable/plus-jakarta-sans';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'LASUATOS | Lagos State University',
    template: '%s | LASUATOS',
  },
  description:
    'Lecture attendance in seconds for Lagos State University: lecturers and class reps show a QR code, students scan it.',
  applicationName: 'LASUATOS',
  appleWebApp: { capable: true, title: 'LASUATOS', statusBarStyle: 'default' },
  formatDetection: { telephone: false, email: false, address: false },
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }, { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
  colorScheme: 'light',
  width: 'device-width',
  initialScale: 1,
  // Lets the layout extend under the iPhone notch and home indicator; padding uses env(safe-area-inset-*).
  viewportFit: 'cover',
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
