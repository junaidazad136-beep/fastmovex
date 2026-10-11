'use client';

/** Last-resort error page when even the site layout could not render (e.g. the API is unreachable). Bilingual on purpose. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#fcfbfa', color: '#1b1815', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0 }}>
        <main style={{ textAlign: 'center', padding: 24, maxWidth: 420 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: '#7422E6', margin: '0 auto 20px' }} />
          <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>FastMoveX is taking a short break</h1>
          <p style={{ color: '#5d554d', margin: '0 0 4px' }}>We could not load this page. Please try again in a moment.</p>
          <p dir="rtl" lang="ar" style={{ color: '#5d554d', margin: '0 0 20px' }}>تعذّر تحميل هذه الصفحة. يرجى المحاولة بعد قليل.</p>
          <button type="button" onClick={reset} style={{ background: '#7422E6', color: '#fff', border: 0, borderRadius: 12, padding: '10px 20px', fontWeight: 600, cursor: 'pointer' }}>
            Try again · حاول مرة أخرى
          </button>
        </main>
      </body>
    </html>
  );
}
