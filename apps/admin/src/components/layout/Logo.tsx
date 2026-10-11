import Image from 'next/image';

/** FastMoveX square mark (purple X on a dark tile), same as the shop's app icon. */
export function LogoMark({ className = 'size-8' }: { className?: string }) {
  return <Image src="/brand/fastmovex-mark.svg" alt="" width={48} height={48} unoptimized className={className} />;
}

/** FastMoveX "FMX" wordmark with an "Admin" tag. */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Image src="/brand/fastmovex-logo-light.svg" alt="FastMoveX" width={1065} height={275} unoptimized loading="eager" className="h-7 w-auto" />
      <span className="rounded-md bg-ink-900 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">Admin</span>
    </span>
  );
}
