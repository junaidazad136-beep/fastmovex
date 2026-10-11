/** Read-only star rating, one element. The stars are drawn by CSS (`stars` utility); `label` carries the value for screen readers. */
export function Stars({ value, size = 'size-3.5', label }: { value: number; size?: string; label: string }) {
  const full = Math.round(Math.min(5, Math.max(0, value)) * 2) / 2;
  const px = size === 'size-5' ? '1.25rem' : size === 'size-4' ? '1rem' : '0.875rem';
  return <span className="stars" role="img" aria-label={label} style={{ '--rating': `${full * 20}%`, '--star-size': px } as React.CSSProperties} />;
}
