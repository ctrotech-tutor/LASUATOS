'use client';

/** Last-resort screen if the root layout itself fails. Kept dependency-free. */
export default function GlobalError({ reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <html lang="en-NG">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f5f7f8', color: '#172635' }}>
        <main style={{ display: 'grid', minHeight: '100vh', placeContent: 'center', gap: 14, padding: 24, textAlign: 'center' }}>
          <h1 style={{ margin: 0, fontSize: 26 }}>LASUATOS couldn’t load</h1>
          <p style={{ margin: 0, color: '#56646f' }}>Check your connection and try again.</p>
          <button type="button" onClick={reset} style={{ justifySelf: 'center', minHeight: 46, padding: '0 22px', border: 0, borderRadius: 10, background: '#153b5b', color: '#fff', fontSize: 15, fontWeight: 600 }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
