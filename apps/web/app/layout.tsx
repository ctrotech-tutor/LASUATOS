import type { Metadata, Viewport } from 'next';
import { AppShell } from '../components/app-shell';
import '@fontsource-variable/inter';
import '@fontsource-variable/plus-jakarta-sans';
import './tokens.css';
import './globals.css';
import '../components/ds/ds.css';
import '../components/ds/shell.css';

// Absolute URLs for link previews (WhatsApp, Telegram, X). Vercel supplies the production domain.
const siteUrl = process.env.PUBLIC_APP_URL?.trim()
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000');

const description = 'Lecture attendance in seconds for Lagos State University: lecturers and class reps show a QR code, students scan it.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'LASUATOS | Lagos State University',
    template: '%s | LASUATOS',
  },
  description,
  applicationName: 'LASUATOS',
  openGraph: {
    type: 'website',
    siteName: 'LASUATOS',
    locale: 'en_NG',
    title: 'LASUATOS — Lecture attendance for Lagos State University',
    description,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LASUATOS — Lecture attendance for Lagos State University',
    description,
  },
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
  // An app, not a document: the page never zooms. Inputs use 16px text, so focusing one never
  // zooms either, and the CSS keeps every page inside the screen's width (see globals.css).
  maximumScale: 1,
  userScalable: false,
  // Lets the layout extend under the iPhone notch and home indicator; padding uses env(safe-area-inset-*).
  viewportFit: 'cover',
};

// Runs before the first paint: phones with little memory or few cores (and anyone asking to save
// data) get `data-lite`, which swaps live background blurs for solid fills. Animations stay; they
// only move transforms and opacity, which the GPU handles without the main thread.
// Safari on iPhone ignores user-scalable=no, so its pinch gesture is cancelled here (maps handle
// their own pinch with touch events, which this does not touch).
const noZoomScript = `try{document.addEventListener('gesturestart',function(e){e.preventDefault()},{passive:false})}catch(e){}`;

const liteScript = `try{var n=navigator,c=n.connection;if((n.deviceMemory&&n.deviceMemory<=2)||(n.hardwareConcurrency&&n.hardwareConcurrency<=4)||(c&&c.saveData))document.documentElement.setAttribute('data-lite','')}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-NG" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: liteScript }} />
        <script dangerouslySetInnerHTML={{ __html: noZoomScript }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
