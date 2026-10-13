import Image from 'next/image';

/**
 * FastMoveX brand: the "FMX" wordmark (white or ink letters, purple X with the arrow) and the square mark (purple X on
 * a dark tile). Vector files in public/brand; the accessible name is always the full name.
 */
export function LogoMark({ className = 'size-9' }: { className?: string }) {
  return <Image src="/brand/fastmovex-mark.svg" alt="" width={48} height={48} unoptimized className={className} />;
}

/**
 * The line under the logo ("SHOP SMART · LIVE BETTER"), drawn in the logo's own width so it always sits centred under
 * the letters and scales with the logo — the same layout as the social covers. English is spaced out to fill the
 * width; Arabic keeps its natural spacing (spreading it would break the joined letters).
 */
function Tagline({ text, tone }: { text: string; tone: 'light' | 'dark' }) {
  const arabic = /[\u0600-\u06FF]/.test(text);
  const [a, b] = text.split('·').map((x) => x.trim());
  const fill = tone === 'dark' ? 'rgba(255,255,255,.85)' : '#2c2824';
  const dot = <tspan fill="#9b2ff8" dx={arabic ? 0 : 6}>{' • '}</tspan>;
  return (
    <>
      <svg viewBox="0 0 1065 78" className="mt-[3px] block h-auto w-full overflow-visible" aria-hidden focusable="false">
        {arabic ? (
          <text x="532.5" y="62" textAnchor="middle" direction="rtl" fontSize="74" fontWeight="600" fill={fill} style={{ fontFamily: 'var(--font-arabic)' }}>
            {b !== undefined ? <>{a}{dot}{b}</> : text}
          </text>
        ) : (
          <text x="532.5" y="58" textAnchor="middle" textLength="940" lengthAdjust="spacing" fontSize="52" fontWeight="700" fill={fill}>
            {b !== undefined ? <>{a.toUpperCase()}{dot}{b.toUpperCase()}</> : text.toUpperCase()}
          </text>
        )}
      </svg>
      <span className="sr-only">{text}</span>
    </>
  );
}

export function Logo({ label, tone = 'light', tagline, className = '' }: { label: string; tone?: 'light' | 'dark'; tagline?: string; className?: string }) {
  return (
    <span className={`inline-flex w-[132px] flex-col sm:w-[140px] ${className}`}>
      <Image
        src={tone === 'dark' ? '/brand/fastmovex-logo-dark.svg' : '/brand/fastmovex-logo-light.svg'}
        alt={label}
        width={1065}
        height={275}
        unoptimized
        loading="eager"
        className="block h-auto w-full"
      />
      {tagline ? <Tagline text={tagline} tone={tone} /> : null}
    </span>
  );
}
