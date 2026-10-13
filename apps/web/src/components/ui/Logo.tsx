import Image from 'next/image';

/**
 * FastMoveX brand: the "FMX" wordmark (white or ink letters, purple X with the arrow) and the square mark (purple X on
 * a dark tile). Vector files in public/brand; the accessible name is always the full name.
 */
export function LogoMark({ className = 'size-9' }: { className?: string }) {
  return <Image src="/brand/fastmovex-mark.svg" alt="" width={48} height={48} unoptimized className={className} />;
}

/**
 * The line under the logo ("SHOP SMART · LIVE BETTER"), sized from the logo's own width (container units) so it always
 * sits centred under the letters and scales with the logo — the same layout as the social covers. Plain text (not SVG
 * text): Safari draws SVG text stretched with textLength on top of itself. Arabic keeps its natural letter spacing
 * (spreading it would break the joined letters).
 */
function Tagline({ text, tone }: { text: string; tone: 'light' | 'dark' }) {
  const arabic = /[\u0600-\u06FF]/.test(text);
  const [a, b] = text.split('·').map((x) => x.trim());
  const color = tone === 'dark' ? 'text-white/85' : 'text-ink-800';
  const dot = <span className="mx-[0.8em] inline-block size-[0.45em] shrink-0 rounded-full bg-gradient-to-br from-[#C13CFE] to-[#6711FA]" aria-hidden />;
  const word = (w: string) => (arabic ? <span>{w}</span> : <span className="me-[-0.3em] tracking-[0.3em]">{w.toUpperCase()}</span>);
  return (
    <span data-testid="logo-tagline" className={`mt-[3px] flex items-center justify-center whitespace-nowrap font-bold leading-none ${color} ${arabic ? 'text-[9px] font-semibold supports-[container-type:inline-size]:text-[6.8cqw]' : 'text-[6px] supports-[container-type:inline-size]:text-[4.4cqw]'}`}>
      {b !== undefined ? <>{word(a)}{dot}{word(b)}</> : word(text)}
    </span>
  );
}

export function Logo({ label, tone = 'light', tagline, className = '' }: { label: string; tone?: 'light' | 'dark'; tagline?: string; className?: string }) {
  return (
    <span className={`inline-flex w-[132px] flex-col [container-type:inline-size] sm:w-[140px] ${className}`}>
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
