import Image from 'next/image';

/**
 * FastMoveX brand: the "FMX" wordmark (white or ink letters, purple X with the arrow) and the square mark (purple X on
 * a dark tile). Vector files in public/brand; the accessible name is always the full name.
 */
export function LogoMark({ className = 'size-9' }: { className?: string }) {
  return <Image src="/brand/fastmovex-mark.svg" alt="" width={48} height={48} unoptimized className={className} />;
}

export function Logo({ label, tone = 'light', tagline, className = '' }: { label: string; tone?: 'light' | 'dark'; tagline?: string; className?: string }) {
  return (
    <span className={`inline-flex flex-col items-start ${className}`}>
      <Image
        src={tone === 'dark' ? '/brand/fastmovex-logo-dark.svg' : '/brand/fastmovex-logo-light.svg'}
        alt={label}
        width={1065}
        height={275}
        unoptimized
        loading="eager"
        className="h-[34px] w-auto sm:h-9"
      />
      {tagline ? (
        // letter spacing would break the joined Arabic letters: only Latin taglines are spaced out
        <span className={`mt-0.5 ps-[9%] font-semibold whitespace-nowrap ${/[\u0600-\u06FF]/.test(tagline) ? 'text-[10px]' : 'text-[7.5px] uppercase tracking-[0.24em] sm:text-[8px]'} ${tone === 'dark' ? 'text-white/80' : 'text-ink-800'}`}>
          {tagline}
        </span>
      ) : null}
    </span>
  );
}
