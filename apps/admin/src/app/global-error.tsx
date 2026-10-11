'use client';

/** Last-resort screen when the panel itself fails to render. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0, background: '#f7f5f2' }}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 18 }}>Something went wrong</h1>
          <p style={{ color: '#655d55' }}>Reload the page. If it keeps happening, tell the technical team the time it happened.</p>
          <button type="button" onClick={reset} style={{ marginTop: 12, padding: '8px 16px', borderRadius: 8, border: 0, background: '#7422E6', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
