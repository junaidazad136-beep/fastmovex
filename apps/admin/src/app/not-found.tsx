import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-ink-50 px-4 text-center">
      <p className="text-5xl font-bold text-brand-600">404</p>
      <h1 className="text-lg font-semibold">This page does not exist</h1>
      <Link href="/" className="btn-primary">Back to the dashboard</Link>
    </main>
  );
}
