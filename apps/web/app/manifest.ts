import type { MetadataRoute } from 'next';

/** Makes LASUATOS installable ("Add to Home screen" / "Install app") with its own window and icon. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'LASUATOS — Lagos State University attendance',
    short_name: 'LASUATOS',
    description: 'Mark and take lecture attendance in seconds with a QR code.',
    start_url: '/launch',
    scope: '/',
    display: 'standalone',
    display_override: ['window-controls-overlay', 'standalone'],
    orientation: 'any',
    background_color: '#f5f7f8',
    theme_color: '#153b5b',
    lang: 'en-NG',
    dir: 'ltr',
    categories: ['education', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Mark attendance', short_name: 'Scan', url: '/a', description: 'Scan the class QR code', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Take attendance', short_name: 'Take', url: '/sessions', description: 'Start a session and show the QR code', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'My attendance', short_name: 'History', url: '/attendance', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
